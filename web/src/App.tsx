import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'

interface Tab {
  id: string
  name: string
  content: string
}

interface HistoryRecord {
  id: number
  tab_id: string
  content: string
  created: string
}

interface SnapshotRecord {
  id: number
  name: string
  description: string
  tabs_data: string
  created: string
}

interface Message {
  type: string
  tabId?: string
  content?: string
  name?: string
  tabs?: Tab[]
}

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('default')
  const [previewMode, setPreviewMode] = useState(false)
  const [connected, setConnected] = useState(false)
  const [activeUsers, setActiveUsers] = useState(1)
  const [error, setError] = useState('')
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabName, setEditingTabName] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [snapshots, setSnapshots] = useState<SnapshotRecord[]>([])
  const [snapshotName, setSnapshotName] = useState('')
  const [snapshotDesc, setSnapshotDesc] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const editorRef = useRef<any>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeTab = tabs.find(t => t.id === activeTabId)

  const connectWebSocket = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)

    ws.onopen = () => {
      console.log('WebSocket connected')
      setConnected(true)
      setError('')
    }

    ws.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data)
      
      if (msg.type === 'init' && msg.tabs) {
        setTabs(msg.tabs)
        if (msg.tabs.length > 0 && !activeTabId) {
          setActiveTabId(msg.tabs[0].id)
        }
      } else if (msg.type === 'update' && msg.tabId) {
        setTabs(prev => prev.map(tab =>
          tab.id === msg.tabId ? { ...tab, content: msg.content || '' } : tab
        ))
      } else if (msg.type === 'create' && msg.tabId && msg.name) {
        setTabs(prev => [...prev, { id: msg.tabId, name: msg.name, content: '' }])
        setActiveTabId(msg.tabId)
      } else if (msg.type === 'rename' && msg.tabId && msg.name) {
        setTabs(prev => prev.map(tab =>
          tab.id === msg.tabId ? { ...tab, name: msg.name } : tab
        ))
      } else if (msg.type === 'delete' && msg.tabId) {
        setTabs(prev => {
          const newTabs = prev.filter(tab => tab.id !== msg.tabId)
          if (activeTabId === msg.tabId && newTabs.length > 0) {
            setActiveTabId(newTabs[0].id)
          }
          return newTabs
        })
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setError('Connection error')
      setConnected(false)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setConnected(false)
      setTimeout(() => {
        if (authenticated) {
          connectWebSocket()
        }
      }, 3000)
    }

    wsRef.current = ws
  }, [authenticated, activeTabId])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })

      if (response.ok) {
        const data = await response.json()
        localStorage.setItem('token', data.token)
        setAuthenticated(true)
        connectWebSocket()
      } else {
        setError('Invalid password')
      }
    } catch (err) {
      setError('Connection failed')
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Message = {
        type: 'update',
        tabId: activeTabId,
        content: value,
      }
      wsRef.current.send(JSON.stringify(msg))
      setTabs(prev => prev.map(tab =>
        tab.id === activeTabId ? { ...tab, content: value } : tab
      ))
    }
  }

  const createNewTab = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const newId = `tab-${Date.now()}`
      const msg: Message = {
        type: 'create',
        tabId: newId,
        name: `Tab ${tabs.length + 1}`,
      }
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  const renameTab = (tabId: string, newName: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN && newName.trim()) {
      const msg: Message = {
        type: 'rename',
        tabId: tabId,
        name: newName.trim(),
      }
      wsRef.current.send(JSON.stringify(msg))
    }
    setEditingTabId(null)
    setEditingTabName('')
  }

  const deleteTab = (tabId: string) => {
    if (tabs.length <= 1) {
      alert('Cannot delete the last tab')
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Message = {
        type: 'delete',
        tabId: tabId,
      }
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  const clearCurrentTab = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Message = {
        type: 'update',
        tabId: activeTabId,
        content: '',
      }
      wsRef.current.send(JSON.stringify(msg))
    }
  }

  const loadHistory = async () => {
    try {
      const response = await fetch(`/api/history?tabId=${activeTabId}`)
      if (response.ok) {
        const data = await response.json()
        setHistory(data || [])
        setShowHistory(true)
      }
    } catch (err) {
      console.error('Failed to load history:', err)
    }
  }

  const restoreHistory = (record: HistoryRecord) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Message = {
        type: 'update',
        tabId: activeTabId,
        content: record.content,
      }
      wsRef.current.send(JSON.stringify(msg))
      setShowHistory(false)
    }
  }

  const loadSnapshots = async () => {
    try {
      const response = await fetch('/api/snapshots')
      if (response.ok) {
        const data = await response.json()
        setSnapshots(data || [])
        setShowSnapshots(true)
      }
    } catch (err) {
      console.error('Failed to load snapshots:', err)
    }
  }

  const createSnapshot = async () => {
    if (!snapshotName.trim()) {
      alert('Please enter a snapshot name')
      return
    }

    try {
      const response = await fetch('/api/snapshots', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: snapshotName,
          description: snapshotDesc,
        }),
      })

      if (response.ok) {
        setSnapshotName('')
        setSnapshotDesc('')
        loadSnapshots()
        alert('Snapshot created successfully!')
      }
    } catch (err) {
      console.error('Failed to create snapshot:', err)
    }
  }

  const restoreSnapshot = (snapshot: SnapshotRecord) => {
    try {
      const tabs = JSON.parse(snapshot.tabs_data)
      if (confirm(`Restore snapshot "${snapshot.name}"? This will replace all current tabs.`)) {
        // Send delete for all current tabs except first
        tabs.forEach((tab: Tab, index: number) => {
          if (index === 0) {
            // Update first tab
            const msg: Message = {
              type: 'update',
              tabId: tab.id,
              content: tab.content,
            }
            wsRef.current?.send(JSON.stringify(msg))
          } else {
            // Create additional tabs
            const msg: Message = {
              type: 'create',
              tabId: tab.id,
              name: tab.name,
            }
            wsRef.current?.send(JSON.stringify(msg))
            
            setTimeout(() => {
              const updateMsg: Message = {
                type: 'update',
                tabId: tab.id,
                content: tab.content,
              }
              wsRef.current?.send(JSON.stringify(updateMsg))
            }, 100)
          }
        })
        setShowSnapshots(false)
      }
    } catch (err) {
      console.error('Failed to restore snapshot:', err)
    }
  }

  const handleImageUpload = async (file: File) => {
    const formData = new FormData()
    formData.append('image', file)

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        const imageMarkdown = `![${file.name}](${data.imageUrl})\n`
        const currentContent = activeTab?.content || ''
        handleEditorChange(currentContent + imageMarkdown)
      }
    } catch (err) {
      console.error('Failed to upload image:', err)
    }
  }

  const handlePaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          handleImageUpload(file)
          e.preventDefault()
        }
      }
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = e.dataTransfer.files
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handleImageUpload(files[0])
    }
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [activeTab])

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-2">BoardCast</h1>
            <p className="text-gray-600">Real-time collaborative whiteboard</p>
          </div>
          
          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
                placeholder="Enter password"
                autoFocus
              />
            </div>
            
            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}
            
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition duration-200 shadow-lg hover:shadow-xl"
            >
              Connect
            </button>
          </form>
          
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>Secure collaborative whiteboard</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div 
      className="h-screen flex flex-col bg-gray-50"
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-800">BoardCast</h1>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-600">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-green-100 text-green-700 rounded-lg font-medium hover:bg-green-200 transition"
            title="Upload image"
          >
            Upload Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handleImageUpload(file)
            }}
          />
          <button
            onClick={loadHistory}
            className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 transition"
          >
            History
          </button>
          <button
            onClick={loadSnapshots}
            className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg font-medium hover:bg-indigo-200 transition"
          >
            Snapshots
          </button>
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              previewMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {previewMode ? 'Edit Mode' : 'Preview'}
          </button>
          <button
            onClick={clearCurrentTab}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex items-center space-x-2 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`flex items-center space-x-2 px-4 py-2 rounded-t-lg cursor-pointer transition ${
              activeTabId === tab.id
                ? 'bg-gray-100 border-b-2 border-blue-600'
                : 'hover:bg-gray-50'
            }`}
          >
            {editingTabId === tab.id ? (
              <input
                type="text"
                value={editingTabName}
                onChange={(e) => setEditingTabName(e.target.value)}
                onBlur={() => renameTab(tab.id, editingTabName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') renameTab(tab.id, editingTabName)
                  if (e.key === 'Escape') {
                    setEditingTabId(null)
                    setEditingTabName('')
                  }
                }}
                className="px-2 py-1 border border-gray-300 rounded text-sm"
                autoFocus
              />
            ) : (
              <>
                <span
                  onClick={() => setActiveTabId(tab.id)}
                  onDoubleClick={() => {
                    setEditingTabId(tab.id)
                    setEditingTabName(tab.name)
                  }}
                  className="text-sm font-medium"
                >
                  {tab.name}
                </span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteTab(tab.id)
                    }}
                    className="text-gray-400 hover:text-red-600"
                  >
                    ×
                  </button>
                )}
              </>
            )}
          </div>
        ))}
        <button
          onClick={createNewTab}
          className="px-3 py-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition"
          title="New tab"
        >
          +
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1">
          {previewMode ? (
            <div className="h-full overflow-auto bg-white p-8">
              <div className="max-w-4xl mx-auto prose prose-lg">
                <ReactMarkdown>{activeTab?.content || ''}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <Editor
              height="100%"
              defaultLanguage="markdown"
              value={activeTab?.content || ''}
              onChange={handleEditorChange}
              theme="vs-light"
              options={{
                fontSize: 16,
                wordWrap: 'on',
                minimap: { enabled: false },
                lineNumbers: 'off',
                folding: false,
                scrollBeyondLastLine: false,
                renderLineHighlight: 'none',
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                padding: { top: 20, bottom: 20 },
              }}
              onMount={(editor) => {
                editorRef.current = editor
              }}
            />
          )}
        </div>

        {/* History Sidebar */}
        {showHistory && (
          <div className="w-80 border-l border-gray-200 bg-white p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">History</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            <div className="space-y-2">
              {history.map(record => (
                <div
                  key={record.id}
                  className="border border-gray-200 rounded p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => restoreHistory(record)}
                >
                  <div className="text-xs text-gray-500 mb-1">
                    {new Date(record.created).toLocaleString()}
                  </div>
                  <div className="text-sm text-gray-700 truncate">
                    {record.content.substring(0, 100)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Snapshots Sidebar */}
        {showSnapshots && (
          <div className="w-96 border-l border-gray-200 bg-white p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Snapshots</h3>
              <button
                onClick={() => setShowSnapshots(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            
            <div className="mb-4 p-4 bg-gray-50 rounded">
              <h4 className="font-medium mb-2">Create Snapshot</h4>
              <input
                type="text"
                placeholder="Snapshot name"
                value={snapshotName}
                onChange={(e) => setSnapshotName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded mb-2"
              />
              <input
                type="text"
                placeholder="Description (optional)"
                value={snapshotDesc}
                onChange={(e) => setSnapshotDesc(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded mb-2"
              />
              <button
                onClick={createSnapshot}
                className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
              >
                Create
              </button>
            </div>

            <div className="space-y-2">
              {snapshots.map(snapshot => (
                <div
                  key={snapshot.id}
                  className="border border-gray-200 rounded p-3 hover:bg-gray-50 cursor-pointer"
                  onClick={() => restoreSnapshot(snapshot)}
                >
                  <div className="font-medium text-gray-800">{snapshot.name}</div>
                  {snapshot.description && (
                    <div className="text-sm text-gray-600 mb-1">{snapshot.description}</div>
                  )}
                  <div className="text-xs text-gray-500">
                    {new Date(snapshot.created).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-2 flex items-center justify-between text-sm text-gray-600">
        <div>
          Markdown supported • {activeTab?.content.length || 0} characters • {tabs.length} {tabs.length === 1 ? 'tab' : 'tabs'}
        </div>
        <div className="flex items-center space-x-4">
          <span>Drag & drop or paste images to upload</span>
          <span>•</span>
          <span>Auto-saved</span>
        </div>
      </div>
    </div>
  )
}

export default App
