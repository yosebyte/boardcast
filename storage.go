package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

type Storage struct {
	db *sql.DB
}

type TabRecord struct {
	ID      string
	Name    string
	Content string
	Updated time.Time
}

type HistoryRecord struct {
	ID      int
	TabID   string
	Content string
	Created time.Time
}

type SnapshotRecord struct {
	ID          int
	Name        string
	Description string
	TabsData    string // JSON
	Created     time.Time
}

type ImageRecord struct {
	ID       string
	Filename string
	Data     []byte
	MimeType string
	Size     int64
	Created  time.Time
}

func NewStorage(dataDir string) (*Storage, error) {
	db, err := sql.Open("sqlite", dataDir+"/boardcast.db")
	if err != nil {
		return nil, err
	}

	storage := &Storage{db: db}
	if err := storage.initSchema(); err != nil {
		return nil, err
	}

	return storage, nil
}

func (s *Storage) initSchema() error {
	schema := `
	CREATE TABLE IF NOT EXISTS tabs (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		content TEXT NOT NULL,
		updated DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		tab_id TEXT NOT NULL,
		content TEXT NOT NULL,
		created DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS snapshots (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT,
		tabs_data TEXT NOT NULL,
		created DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS images (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		data BLOB NOT NULL,
		mime_type TEXT NOT NULL,
		size INTEGER NOT NULL,
		created DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_history_tab ON history(tab_id, created DESC);
	CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created DESC);
	`

	_, err := s.db.Exec(schema)
	return err
}

func (s *Storage) SaveTab(tab *Tab) error {
	_, err := s.db.Exec(
		"INSERT OR REPLACE INTO tabs (id, name, content, updated) VALUES (?, ?, ?, ?)",
		tab.ID, tab.Name, tab.Content, time.Now(),
	)
	return err
}

func (s *Storage) LoadTabs() ([]*Tab, error) {
	rows, err := s.db.Query("SELECT id, name, content FROM tabs ORDER BY updated DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tabs []*Tab
	for rows.Next() {
		tab := &Tab{}
		if err := rows.Scan(&tab.ID, &tab.Name, &tab.Content); err != nil {
			return nil, err
		}
		tabs = append(tabs, tab)
	}

	return tabs, nil
}

func (s *Storage) DeleteTab(tabID string) error {
	_, err := s.db.Exec("DELETE FROM tabs WHERE id = ?", tabID)
	return err
}

func (s *Storage) SaveHistory(tabID, content string) error {
	_, err := s.db.Exec(
		"INSERT INTO history (tab_id, content, created) VALUES (?, ?, ?)",
		tabID, content, time.Now(),
	)
	return err
}

func (s *Storage) GetHistory(tabID string, limit int) ([]HistoryRecord, error) {
	rows, err := s.db.Query(
		"SELECT id, tab_id, content, created FROM history WHERE tab_id = ? ORDER BY created DESC LIMIT ?",
		tabID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []HistoryRecord
	for rows.Next() {
		var rec HistoryRecord
		if err := rows.Scan(&rec.ID, &rec.TabID, &rec.Content, &rec.Created); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}

	return records, nil
}

func (s *Storage) CreateSnapshot(name, description string, tabs []*Tab) error {
	tabsJSON, err := json.Marshal(tabs)
	if err != nil {
		return err
	}

	_, err = s.db.Exec(
		"INSERT INTO snapshots (name, description, tabs_data, created) VALUES (?, ?, ?, ?)",
		name, description, string(tabsJSON), time.Now(),
	)
	return err
}

func (s *Storage) GetSnapshots(limit int) ([]SnapshotRecord, error) {
	rows, err := s.db.Query(
		"SELECT id, name, description, tabs_data, created FROM snapshots ORDER BY created DESC LIMIT ?",
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var records []SnapshotRecord
	for rows.Next() {
		var rec SnapshotRecord
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.Description, &rec.TabsData, &rec.Created); err != nil {
			return nil, err
		}
		records = append(records, rec)
	}

	return records, nil
}

func (s *Storage) DeleteSnapshot(snapshotID int) error {
	_, err := s.db.Exec("DELETE FROM snapshots WHERE id = ?", snapshotID)
	return err
}

func (s *Storage) SaveImage(img *ImageRecord) error {
	_, err := s.db.Exec(
		"INSERT INTO images (id, filename, data, mime_type, size, created) VALUES (?, ?, ?, ?, ?, ?)",
		img.ID, img.Filename, img.Data, img.MimeType, img.Size, time.Now(),
	)
	return err
}

func (s *Storage) GetImage(imageID string) (*ImageRecord, error) {
	var img ImageRecord
	err := s.db.QueryRow(
		"SELECT id, filename, data, mime_type, size, created FROM images WHERE id = ?",
		imageID,
	).Scan(&img.ID, &img.Filename, &img.Data, &img.MimeType, &img.Size, &img.Created)
	
	if err != nil {
		return nil, err
	}
	return &img, nil
}

func (s *Storage) Close() error {
	return s.db.Close()
}

func (s *Storage) CleanOldHistory(tabID string, keepCount int) error {
	_, err := s.db.Exec(`
		DELETE FROM history 
		WHERE tab_id = ? AND id NOT IN (
			SELECT id FROM history 
			WHERE tab_id = ? 
			ORDER BY created DESC 
			LIMIT ?
		)
	`, tabID, tabID, keepCount)
	return err
}

func (s *Storage) AutoSaveHistory(hub *Hub) {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		hub.mu.RLock()
		for _, tab := range hub.tabs {
			if err := s.SaveHistory(tab.ID, tab.Content); err != nil {
				log.Printf("Failed to save history for tab %s: %v", tab.ID, err)
			}
		}
		hub.mu.RUnlock()

		// Keep only last 50 history records per tab
		hub.mu.RLock()
		for tabID := range hub.tabs {
			if err := s.CleanOldHistory(tabID, 50); err != nil {
				log.Printf("Failed to clean old history for tab %s: %v", tabID, err)
			}
		}
		hub.mu.RUnlock()
	}
}
