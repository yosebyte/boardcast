# BoardCast Release Notes

## v1.2.0 (2026-02-10)

### Major Features

#### Enhanced Security
- **Environment Variables**: Support for `BOARDCAST_PASSWORD` environment variable (recommended)
- **Password Files**: Support for `--password-file` flag to read password from file
- **JWT Authentication**: Secure token-based authentication with 24-hour expiration
- **Deprecation Warning**: Command-line password flag deprecated for security

#### Persistent Data Storage
- **SQLite Database**: All data stored in SQLite for persistence across restarts
- **Configurable Data Directory**: Use `--data-dir` to specify where data is stored
- **Database Schema**: Optimized tables for tabs, history, snapshots, and images
- **Docker Volume Support**: Persistent data via Docker volumes

#### History Tracking System
- **Auto-Save**: Automatic saving every 5 minutes
- **History Browser**: View and restore previous versions of any tab
- **50 Entry Limit**: Automatically manages history to prevent excessive storage
- **Per-Tab History**: Each tab maintains its own independent history

#### Snapshot System
- **Full Workspace Backup**: Save complete state of all tabs
- **Named Snapshots**: Create snapshots with custom names and descriptions
- **Instant Restore**: Restore entire workspace to any saved snapshot
- **Snapshot Management**: View, restore, and delete snapshots

#### Image Upload Support
- **Multiple Input Methods**: Drag & drop, paste, and upload button
- **Format Support**: JPG, PNG, GIF, WebP with 10MB size limit
- **BLOB Storage**: Images stored efficiently in database
- **Visual Preview**: Thumbnails in image list sidebar

### Technical Improvements
- **Go Best Practices**: Restructured project with `cmd/boardcast/` architecture
- **Docker Multi-Platform**: Support for both amd64 and arm64 architectures
- **Data Persistence**: Volume mounting at `/app/data` for Docker deployments
- **Build Optimization**: Improved Dockerfile with proper dependency management

### Breaking Changes
- **Data Migration**: First-time users need to create database schema (automatic on startup)
- **Command-Line Password**: `--password` flag deprecated, use environment variables or password files

### Security Notes
- Never expose password via command-line arguments (visible in process lists)
- Use environment variables or password files for production deployments
- JWT tokens automatically expire after 24 hours

### Docker Deployment
```bash
docker run -d -p 8080:8080 \
  -e BOARDCAST_PASSWORD=your-secure-password \
  -v boardcast-data:/app/data \
  ghcr.io/yosebyte/boardcast:1.2.0
```

### Migration from v1.1.0
Existing users need to:
1. Set password via environment variable or password file
2. Create data directory for persistent storage
3. First login will initialize new database schema

---

## v1.1.0 (2026-02-10)

### Features
- **Multi-Tab Support**: Create, rename, delete, and switch between multiple whiteboards
- **Tab Management**: Intuitive sidebar for managing multiple tabs
- **Independent Tabs**: Each tab maintains its own canvas state
- **Real-Time Sync**: All tab operations synchronized across connected clients

### UI Improvements
- Tab sidebar with create, rename, and delete operations
- Active tab highlighting
- Improved layout with collapsible sidebar

### Technical Changes
- WebSocket protocol extended for tab operations
- Client-side tab state management
- Server-side multi-tab data structures

### Docker Image
```bash
docker pull ghcr.io/yosebyte/boardcast:1.1.0
```

---

## v1.0.0 (2026-02-10)

### Initial Release

#### Core Features
- **Real-Time Collaboration**: Multiple users can draw simultaneously
- **Free Drawing**: Smooth brush strokes with adjustable size and color
- **Shapes**: Rectangle, circle, line, and arrow tools
- **Text Tool**: Add text annotations with customizable size and color
- **Eraser**: Remove content with adjustable size
- **Pan & Zoom**: Navigate large canvases easily
- **Undo/Redo**: Full undo/redo support
- **Clear Canvas**: Reset canvas to blank state

#### Technical Stack
- **Frontend**: React + TypeScript + HTML Canvas
- **Backend**: Go + Gorilla WebSocket + CORS support
- **Real-Time**: WebSocket-based synchronization
- **Deployment**: Docker with multi-platform support (amd64/arm64)

#### Security
- Password-protected access (basic authentication)
- CORS configuration for secure cross-origin requests

#### Docker Deployment
```bash
docker pull ghcr.io/yosebyte/boardcast:1.0.0
docker run -d -p 8080:8080 -e PASSWORD=your-password ghcr.io/yosebyte/boardcast:1.0.0
```

### Known Limitations
- No persistent storage (data lost on restart)
- Command-line password only
- Single canvas workspace

---

## License

Copyright (c) 2026, Mikyla  
Licensed under BSD 3-Clause License
