package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

var (
	port     = flag.String("port", "8080", "Server port")
	password = flag.String("password", "boardcast", "Authentication password")
	upgrader = websocket.Upgrader{
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
	mu         sync.RWMutex
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

type Message struct {
	Type    string  `json:"type"`
	TabID   string  `json:"tabId,omitempty"`
	Content string  `json:"content,omitempty"`
	Name    string  `json:"name,omitempty"`
	Token   string  `json:"token,omitempty"`
	Tabs    []*Tab  `json:"tabs,omitempty"`
}

func newHub() *Hub {
	hub := &Hub{
		broadcast:  make(chan []byte, 256),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
		tabs:       make(map[string]*Tab),
	}
	
	// Create default tab
	defaultTab := &Tab{
		ID:      "default",
		Name:    "Main",
		Content: "",
	}
	hub.tabs[defaultTab.ID] = defaultTab
	
	return hub
}

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			// Send all tabs to new client
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
					}
				case "create":
					newTab := &Tab{
						ID:      msg.TabID,
						Name:    msg.Name,
						Content: "",
					}
					h.tabs[newTab.ID] = newTab
				case "rename":
					if tab, exists := h.tabs[msg.TabID]; exists {
						tab.Name = msg.Name
					}
				case "delete":
					delete(h.tabs, msg.TabID)
				}
				h.mu.Unlock()
			}

			// Broadcast to all clients
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

			// Add queued messages to current websocket message
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

func hashPassword(pwd string) string {
	hash := sha256.Sum256([]byte(pwd))
	return hex.EncodeToString(hash[:])
}

func handleAuth(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Password == *password {
		token := hashPassword(*password + time.Now().String())
		json.NewEncoder(w).Encode(map[string]string{
			"token": token,
		})
		log.Println("User authenticated successfully")
	} else {
		http.Error(w, "Invalid password", http.StatusUnauthorized)
		log.Println("Authentication failed: invalid password")
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

func main() {
	flag.Parse()

	hub := newHub()
	go hub.run()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth", handleAuth)
	mux.HandleFunc("/api/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(hub, w, r)
	})

	// Serve static files
	fs := http.FileServer(http.Dir("./web/build"))
	mux.Handle("/", fs)

	handler := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: true,
	}).Handler(mux)

	addr := fmt.Sprintf(":%s", *port)
	log.Printf("BoardCast server starting on http://localhost:%s", *port)
	log.Printf("Password: %s", *password)
	log.Fatal(http.ListenAndServe(addr, handler))
}
