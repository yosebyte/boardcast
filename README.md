# BoardCast

A lightweight, real-time collaborative text editor with multi-tab support and persistent storage.

## Features

- **Real-time Collaboration**: WebSocket-based synchronization across multiple clients
- **Multi-Tab Workspace**: Create, rename, and manage multiple tabs
- **Persistent Storage**: SQLite database for reliable data persistence
- **Theme Switching**: System, Light, and Dark modes with full UI adaptation
- **Adjustable Font Size**: Customize editor font size (10-32px)
- **Monaco Editor**: Professional code editor with syntax highlighting and line numbers
- **Session-based Authentication**: Secure HTTP-only cookie authentication
- **Automatic Reconnection**: Seamless reconnection on connection loss
- **Optimized Input**: Debounced updates and cursor position preservation for smooth typing
- **Mobile-Friendly**: Responsive design with collapsible sidebar for mobile devices

## Quick Start

### Docker Deployment

```bash
docker run -d \
  -p 8080:8080 \
  -e BOARDCAST_PASSWORD=your-secure-password \
  -v boardcast-data:/app/data \
  ghcr.io/yosebyte/boardcast:latest
```

### Environment Variables

- `BOARDCAST_PASSWORD` - Authentication password (required)
- `BOARDCAST_PASSWORD_FILE` - Path to password file (alternative to BOARDCAST_PASSWORD)
- `BOARDCAST_DATA_DIR` - Data directory path (default: `./data`)
- `BOARDCAST_PORT` - HTTP server port (default: `8080`)

### Using Password File

```bash
# Create password file
echo "your-secure-password" > /path/to/password.txt
chmod 600 /path/to/password.txt

# Run with password file
docker run -d \
  -p 8080:8080 \
  -v /path/to/password.txt:/secrets/password:ro \
  -v boardcast-data:/app/data \
  -e BOARDCAST_PASSWORD_FILE=/secrets/password \
  ghcr.io/yosebyte/boardcast:latest
```

### Docker Compose

```yaml
version: '3.8'

services:
  boardcast:
    image: ghcr.io/yosebyte/boardcast:latest
    ports:
      - "8080:8080"
    environment:
      BOARDCAST_PASSWORD: your-secure-password
      # Or use password file:
      # BOARDCAST_PASSWORD_FILE: /secrets/password
    volumes:
      - boardcast-data:/app/data
      # If using password file:
      # - ./password.txt:/secrets/password:ro
    restart: unless-stopped

volumes:
  boardcast-data:
```

### Manual Build and Run

```bash
# Clone repository
git clone https://github.com/yosebyte/boardcast.git
cd boardcast

# Build frontend
cd web
npm install
npm run build
cd ..

# Build and run backend
go build -trimpath -ldflags "-s -w" -o boardcast ./cmd/boardcast
BOARDCAST_PASSWORD=your-password ./boardcast
```

## Usage

1. Open http://localhost:8080 in your browser
2. Enter your password to authenticate
3. Start editing:
   - Toggle sidebar visibility with the menu button (helpful on mobile)
   - Create new tabs with the "+ New Tab" button
   - Switch between tabs in the sidebar
   - Rename tabs by clicking the edit icon
   - Delete tabs by clicking the delete icon (minimum 1 tab required)
4. Adjust preferences:
   - Click the +/- buttons to increase/decrease font size
   - Click the theme button to cycle between System/Light/Dark modes
5. Your changes are automatically saved and synced across all connected clients

## Mobile Support

BoardCast is fully responsive and mobile-friendly:
- **Collapsible Sidebar**: Toggle sidebar visibility to maximize editor space
- **Touch-Friendly**: All buttons and controls are optimized for touch input
- **Minimum Viewport**: Supports devices as small as 320x480 pixels
- **Responsive Text**: Status bar adapts to screen size

## Architecture

### Backend (Go)

- **HTTP Server**: Serves static files and handles API requests
- **WebSocket Server**: Real-time bidirectional communication
- **Session Management**: Server-side sessions with HTTP-only cookies
- **Storage**: SQLite database with automatic schema initialization

**Database Schema:**
- `tabs`: Store tab content with unique IDs, names, and timestamps

### Frontend (React + TypeScript)

- **Monaco Editor**: VS Code's editor component for professional editing experience
- **WebSocket Client**: Manages real-time synchronization with automatic reconnection
- **State Management**: React hooks for efficient state updates
- **Theme System**: CSS variables and Tailwind classes for consistent theming
- **Input Optimization**: Cursor position preservation and debounced updates
- **Responsive Design**: Mobile-first approach with flexible layout

## Security

- **Authentication**: Password-based authentication with session cookies
- **HTTP-only Cookies**: Prevents XSS attacks by making cookies inaccessible to JavaScript
- **Session Expiration**: Automatic session cleanup (24-hour expiration)
- **Password Options**: Environment variable or secure file-based password storage
- **CORS**: Configured for same-origin requests only

## Data Persistence

All data is stored in SQLite database at the configured data directory (default: `./data`).

**Backup:**
```bash
# Stop container
docker stop boardcast

# Backup data volume
docker run --rm -v boardcast-data:/data -v $(pwd):/backup alpine tar czf /backup/boardcast-backup.tar.gz -C /data .

# Restart container
docker start boardcast
```

**Restore:**
```bash
# Stop container
docker stop boardcast

# Restore data volume
docker run --rm -v boardcast-data:/data -v $(pwd):/backup alpine tar xzf /backup/boardcast-backup.tar.gz -C /data

# Restart container
docker start boardcast
```

## Development

### Requirements

- Go 1.20+
- Node.js 18+
- npm or yarn

### Local Development

```bash
# Terminal 1: Backend
go run ./cmd/boardcast

# Terminal 2: Frontend
cd web
npm install
npm run dev
```

Frontend dev server runs on http://localhost:5173 and proxies API requests to the backend on port 8080.

## Build Optimization

The binary is built with optimization flags to reduce size:
- `-trimpath`: Remove file system paths from binary
- `-ldflags "-s -w"`: Strip debug information and symbol tables

Typical binary size: ~15-20MB (compared to ~40MB without optimization)

## License

BSD-3-Clause License

Copyright (c) 2026, Mikyla
