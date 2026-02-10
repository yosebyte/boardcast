package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

var (
	port         = flag.String("port", "8080", "Server port")
	password     = flag.String("password", "", "Authentication password (deprecated, use env or file)")
	passwordFile = flag.String("password-file", "", "Path to password file")
	dataDir      = flag.String("data-dir", "./data", "Data directory for database and uploads")
	jwtSecret    []byte
	upgrader     = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
)

type Tab struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Content string `json:"content"`
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan []byte
	register   chan *Client
	unregister chan *Client
	tabs       map[string]*Tab
	storage    *Storage
	mu         sync.RWMutex
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

type Message struct {
	Type         string              `json:"type"`
	TabID        string              `json:"tabId,omitempty"`
	Content      string              `json:"content,omitempty"`
	Name         string              `json:"name,omitempty"`
	Description  string              `json:"description,omitempty"`
	Token        string              `json:"token,omitempty"`
	Tabs         []*Tab              `json:"tabs,omitempty"`
	History      []HistoryRecord     `json:"history,omitempty"`
	Snapshots    []SnapshotRecord    `json:"snapshots,omitempty"`
	SnapshotID   int                 `json:"snapshotId,omitempty"`
	HistoryID    int                 `json:"historyId,omitempty"`
	ImageID      string              `json:"imageId,omitempty"`
	ImageURL     string              `json:"imageUrl,omitempty"`
	Limit        int                 `json:"limit,omitempty"`
}

func getPassword() string {
	// Priority: 1. Environment variable, 2. Password file, 3. Command line flag
	if envPass := os.Getenv("BOARDCAST_PASSWORD"); envPass != "" {
		return envPass
	}

	if *passwordFile != "" {
		data, err := os.ReadFile(*passwordFile)
		if err != nil {
			log.Fatalf("Failed to read password file: %v", err)
		}
		return strings.TrimSpace(string(data))
	}

	if *password != "" {
		log.Println("Warning: Using --password flag is deprecated. Use BOARDCAST_PASSWORD env or --password-file instead")
		return *password
	}

	log.Println("Warning: No password set. Using default password 'boardcast'")
	return "boardcast"
}

func generateJWTSecret() {
	jwtSecret = make([]byte, 32)
	if _, err := rand.Read(jwtSecret); err != nil {
		log.Fatal("Failed to generate JWT secret:", err)
	}
}

func createToken(password string) (string, error) {
	claims := jwt.MapClaims{
		"authorized": true,
		"exp":        time.Now().Add(24 * time.Hour).Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(jwtSecret)
}

func verifyToken(tokenString string) error {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtSecret, nil
	})

	if err != nil {
		return err
	}

	if !token.Valid {
		return fmt.Errorf("invalid token")
	}

	return nil
}

func newHub(storage *Storage) *Hub {
	hub := &Hub{
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		tabs:       make(map[string]*Tab),
		storage:    storage,
	}

	// Load tabs from storage
	tabs, err := storage.LoadTabs()
	if err != nil {
		log.Printf("Failed to load tabs: %v", err)
	} else if len(tabs) > 0 {
		for _, tab := range tabs {
			hub.tabs[tab.ID] = tab
		}
		log.Printf("Loaded %d tabs from storage", len(tabs))
	}

	// Create default tab if none exist
	if len(hub.tabs) == 0 {
		defaultTab := &Tab{
			ID:      "default",
			Name:    "Main",
			Content: "",
		}
		hub.tabs[defaultTab.ID] = defaultTab
		storage.SaveTab(defaultTab)
	}

	return hub
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			h.mu.RLock()
			tabs := make([]*Tab, 0, len(h.tabs))
			for _, tab := range h.tabs {
				tabs = append(tabs, tab)
			}
			h.mu.RUnlock()

			msg, _ := json.Marshal(Message{
				Type: "init",
				Tabs: tabs,
			})
			client.send <- msg
			log.Printf("Client connected. Total clients: %d", len(h.clients))

		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("Client disconnected. Total clients: %d", len(h.clients))
			}

		case message := <-h.broadcast:
			var msg Message
			if err := json.Unmarshal(message, &msg); err == nil {
				h.mu.Lock()
				switch msg.Type {
				case "update":
					if tab, exists := h.tabs[msg.TabID]; exists {
						tab.Content = msg.Content
						h.storage.SaveTab(tab)
					}
				case "create":
					newTab := &Tab{
						ID:      msg.TabID,
						Name:    msg.Name,
						Content: "",
					}
					h.tabs[newTab.ID] = newTab
					h.storage.SaveTab(newTab)
				case "rename":
					if tab, exists := h.tabs[msg.TabID]; exists {
						tab.Name = msg.Name
						h.storage.SaveTab(tab)
					}
				case "delete":
					delete(h.tabs, msg.TabID)
					h.storage.DeleteTab(msg.TabID)
				}
				h.mu.Unlock()
			}

			for client := range h.clients {
				select {
				case client.send <- message:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error: %v", err)
			}
			break
		}
		c.hub.broadcast <- message
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(54 * time.Second)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			n := len(c.send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func handleAuth(pwd string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Password string `json:"password"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request", http.StatusBadRequest)
			return
		}

		if req.Password == pwd {
			token, err := createToken(pwd)
			if err != nil {
				http.Error(w, "Failed to create token", http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(map[string]string{
				"token": token,
			})
			log.Println("User authenticated successfully")
		} else {
			http.Error(w, "Invalid password", http.StatusUnauthorized)
			log.Println("Authentication failed: invalid password")
		}
	}
}

func handleWebSocket(hub *Hub, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}

	client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256)}
	client.hub.register <- client

	go client.writePump()
	go client.readPump()
}

func handleHistory(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tabID := r.URL.Query().Get("tabId")
		if tabID == "" {
			http.Error(w, "Missing tabId", http.StatusBadRequest)
			return
		}

		limit := 20
		history, err := hub.storage.GetHistory(tabID, limit)
		if err != nil {
			http.Error(w, "Failed to get history", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(history)
	}
}

func handleSnapshot(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			var req struct {
				Name        string `json:"name"`
				Description string `json:"description"`
			}

			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}

			hub.mu.RLock()
			tabs := make([]*Tab, 0, len(hub.tabs))
			for _, tab := range hub.tabs {
				tabs = append(tabs, tab)
			}
			hub.mu.RUnlock()

			if err := hub.storage.CreateSnapshot(req.Name, req.Description, tabs); err != nil {
				http.Error(w, "Failed to create snapshot", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusCreated)
		} else if r.Method == "GET" {
			snapshots, err := hub.storage.GetSnapshots(50)
			if err != nil {
				http.Error(w, "Failed to get snapshots", http.StatusInternalServerError)
				return
			}

			json.NewEncoder(w).Encode(snapshots)
		} else if r.Method == "DELETE" {
			var req struct {
				ID int `json:"id"`
			}

			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "Invalid request", http.StatusBadRequest)
				return
			}

			if err := hub.storage.DeleteSnapshot(req.ID); err != nil {
				http.Error(w, "Failed to delete snapshot", http.StatusInternalServerError)
				return
			}

			w.WriteHeader(http.StatusOK)
		}
	}
}

func handleImageUpload(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		if err := r.ParseMultipartForm(10 << 20); err != nil { // 10MB max
			http.Error(w, "File too large", http.StatusBadRequest)
			return
		}

		file, header, err := r.FormFile("image")
		if err != nil {
			http.Error(w, "Failed to read file", http.StatusBadRequest)
			return
		}
		defer file.Close()

		data, err := io.ReadAll(file)
		if err != nil {
			http.Error(w, "Failed to read file data", http.StatusInternalServerError)
			return
		}

		imageID := fmt.Sprintf("%d", time.Now().UnixNano())
		img := &ImageRecord{
			ID:       imageID,
			Filename: header.Filename,
			Data:     data,
			MimeType: header.Header.Get("Content-Type"),
			Size:     header.Size,
		}

		if err := hub.storage.SaveImage(img); err != nil {
			http.Error(w, "Failed to save image", http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]string{
			"imageId":  imageID,
			"imageUrl": fmt.Sprintf("/api/images/%s", imageID),
		})
	}
}

func handleImageGet(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		imageID := strings.TrimPrefix(r.URL.Path, "/api/images/")
		if imageID == "" {
			http.Error(w, "Missing image ID", http.StatusBadRequest)
			return
		}

		img, err := hub.storage.GetImage(imageID)
		if err != nil {
			http.Error(w, "Image not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", img.MimeType)
		w.Header().Set("Content-Disposition", fmt.Sprintf("inline; filename=%s", img.Filename))
		w.Write(img.Data)
	}
}

func main() {
	flag.Parse()

	// Get password from secure source
	pwd := getPassword()
	generateJWTSecret()

	// Create data directory
	if err := os.MkdirAll(*dataDir, 0755); err != nil {
		log.Fatal("Failed to create data directory:", err)
	}

	// Initialize storage
	storage, err := NewStorage(*dataDir)
	if err != nil {
		log.Fatal("Failed to initialize storage:", err)
	}
	defer storage.Close()

	hub := newHub(storage)
	go hub.run()

	// Start auto-save goroutine
	go storage.AutoSaveHistory(hub)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth", handleAuth(pwd))
	mux.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(hub, w, r)
	})
	mux.HandleFunc("/api/history", handleHistory(hub))
	mux.HandleFunc("/api/snapshots", handleSnapshot(hub))
	mux.HandleFunc("/api/upload", handleImageUpload(hub))
	mux.HandleFunc("/api/images/", handleImageGet(hub))

	// Serve static files
	fs := http.FileServer(http.Dir("./web/build"))
	mux.Handle("/", fs)

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(mux)

	addr := fmt.Sprintf(":%s", *port)
	log.Printf("BoardCast server starting on http://localhost:%s", *port)
	log.Printf("Data directory: %s", *dataDir)
	log.Printf("Password configured: %s", "Yes")
	log.Fatal(http.ListenAndServe(addr, handler))
}
