# BoardCast Release Notes

## v1.2.0 - Security & Data Management (2024-02-10)

### Major Features

#### Enhanced Security
- **Environment Variable Support**: Configure password via `BOARDCAST_PASSWORD` environment variable (recommended method)
- **Password File Support**: Read password from file using `--password-file` flag (most secure for Docker secrets)
- **JWT Authentication**: Session-based JWT tokens with 24-hour expiration
- **Secure by Default**: Command-line password flag marked deprecated to prevent process list exposure

#### Persistent Storage
- **SQLite Database**: All data now persisted in SQLite database
- **Data Directory**: Configurable data directory via `--data-dir` flag (default: `./data`)
- **Automatic Schema**: Database schema auto-initialized on first run
- **Docker Volumes**: Support for persistent Docker volumes

#### History Tracking
- **Complete History**: Full edit history for every tab
- **Auto-save**: Automatic history snapshots every 5 minutes
- **History Viewer**: Sidebar UI to browse and restore historical versions
- **Smart Cleanup**: Keeps last 50 history entries per tab automatically
- **Timestamps**: All history records include creation timestamps

#### Snapshot System
- **Full Workspace Snapshots**: Save complete state of all tabs
- **Named Snapshots**: Create snapshots with custom names and descriptions
- **One-Click Restore**: Restore entire workspace from any snapshot
- **Snapshot Management**: List, create, and delete snapshots via UI
- **Metadata**: Snapshots include creation time and tab count

#### Image Management
- **Drag & Drop Upload**: Drag image files anywhere in the editor
- **Paste Upload**: Paste images directly from clipboard (Ctrl+V/Cmd+V)
- **Upload Button**: Traditional file picker for image upload
- **Database Storage**: Images stored as BLOBs in SQLite
- **Automatic Markdown**: Inserted images auto-generate Markdown syntax
- **Multiple Formats**: Support for JPG, PNG, GIF, WebP
- **Size Limit**: 10MB maximum file size per image

### Technical Improvements

**Backend**:
- New `Storage` layer with SQLite database
- JWT token generation and validation
- Image upload endpoint (`/api/upload`)
- Image serving endpoint (`/api/images/:id`)
- History endpoint (`/api/history?tabId=...`)
- Snapshots CRUD endpoints (`/api/snapshots`)
- Auto-save goroutine for periodic history snapshots
- Better error handling and logging

**Frontend**:
- History sidebar with record browsing
- Snapshot sidebar with create/restore UI
- Image upload button and file picker
- Paste event handler for image upload
- Drag & drop zone for images
- Better state management for sidebars
- Improved UX with loading states

**Database Schema**:
```sql
tables:
  - id (primary key)
  - name
  - content
  - updated timestamp

history:
  - id (auto-increment)
  - tab_id (foreign key)
  - content
  - created timestamp

snapshots:
  - id (auto-increment)
  - name
  - description
  - tabs_data (JSON)
  - created timestamp

images:
  - id (primary key)
  - filename
  - data (BLOB)
  - mime_type
  - size
  - created timestamp
```

### Security Best Practices

#### Password Configuration Priority
1. Environment variable (`BOARDCAST_PASSWORD`) - Recommended
2. Password file (`--password-file`) - Most secure for Docker
3. Command-line flag (`--password`) - Deprecated

#### Docker Security Example
```bash
# Using environment variable
docker run -e BOARDCAST_PASSWORD=secure-password boardcast

# Using Docker secrets (recommended)
docker run -v /path/to/password.txt:/run/secrets/password:ro \
  boardcast --password-file /run/secrets/password
```

### Migration Guide

#### From v1.1.0 to v1.2.0

**Docker Users**:
```bash
# Old (v1.1.0)
docker run -p 8080:8080 boardcast --password mypass

# New (v1.2.0 - recommended)
docker run -p 8080:8080 \
  -e BOARDCAST_PASSWORD=mypass \
  -v boardcast-data:/app/data \
  boardcast:latest
```

**Binary Users**:
```bash
# Old (v1.1.0)
./boardcast --password mypass

# New (v1.2.0 - recommended)
export BOARDCAST_PASSWORD=mypass
./boardcast --data-dir ./data
```

**Data Persistence**:
- First run will create `./data/boardcast.db` automatically
- All existing in-memory data will be lost after upgrade
- Recommend creating initial snapshot after upgrade
- Use Docker volumes to persist data across container restarts

### Breaking Changes

None - v1.2.0 is backward compatible with v1.1.0 in terms of core functionality. However:
- In-memory data from v1.1.0 will not persist (as there was no persistence)
- New data directory required for database storage
- Password configuration method changed (old method still works but deprecated)

### Known Issues

- Large history accumulation may slow down database (mitigated by auto-cleanup)
- Image uploads limited to 10MB (configurable in code)
- Snapshot restore doesn't preserve tab order exactly

### What's Next (v1.3.0 Roadmap)

- User management and multi-user support
- Real-time collaborative editing cursors
- Export to PDF/HTML
- Full-text search across all tabs
- Tag system for tab organization
- Dark mode theme

---

## v1.1.0 - Multi-Tab Support (2024-02-10)

### New Features

- **Multi-tab Interface**: Create unlimited tabs for content organization
- **Tab Management**: Full CRUD operations on tabs
  - Create new tabs with `+` button
  - Rename tabs by double-clicking
  - Delete tabs with `×` button
  - Switch between tabs with click
- **Real-time Tab Sync**: All tab operations synchronized across sessions
- **Tab Persistence**: Tabs maintained across WebSocket reconnections

### Improvements

- Enhanced UI with tab bar component
- Better content organization capabilities
- Improved status bar showing tab count
- Keyboard shortcuts for tab navigation

### Technical Details

**Backend**:
- Extended `Hub` structure to manage multiple tabs
- New message types: `create`, `rename`, `delete`
- Tab stored in `map[string]*Tab` structure

**Frontend**:
- New tab bar component with inline editing
- Tab state managed via React hooks
- Double-click to rename functionality

---

## v1.0.0 - Initial Release (2024-02-10)

### Features

- **Real-time Synchronization**: WebSocket-based instant sync across all connected sessions
- **Markdown Editor**: Monaco Editor (VS Code engine) with syntax highlighting
- **Markdown Preview**: Live preview mode for rendered Markdown
- **Password Protection**: Simple password-based authentication
- **Modern UI**: Clean interface built with React and TailwindCSS
- **Auto-reconnect**: Automatic WebSocket reconnection on disconnect
- **Cross-platform**: Docker images for linux/amd64 and linux/arm64

### Technical Stack

- **Backend**: Go + Gorilla WebSocket + CORS
- **Frontend**: React 18 + TypeScript + Vite + Monaco Editor + TailwindCSS
- **Build**: Multi-stage Docker build with frontend and backend compilation
- **CI/CD**: GitHub Actions for automated builds and GHCR publishing

### Docker Deployment

```bash
docker run -d -p 8080:8080 \
  ghcr.io/yosebyte/boardcast:latest \
  --password your-password
```

### Command-line Options

- `--port`: Server port (default: 8080)
- `--password`: Authentication password (default: boardcast)

---

## Upgrade Instructions

### v1.1.0 → v1.2.0

1. **Stop existing instance**
2. **Pull new image**: `docker pull ghcr.io/yosebyte/boardcast:1.2.0`
3. **Update password method**: Switch to environment variable or password file
4. **Add data volume**: Mount `/app/data` for persistence
5. **Start new instance** with new configuration

### v1.0.0 → v1.2.0

Follow same steps as v1.1.0 → v1.2.0. Note that multi-tab feature from v1.1.0 is included.
