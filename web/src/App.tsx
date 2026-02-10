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
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('default')
  const [previewMode, setPreviewMode] = useState(false)
  const [connected, setConnected] = useState(false)
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

  const checkAuth = useCallback(async () => {
    try {
      const response = await fetch('/api/auth', {
        credentials: 'include'
      })
      if (response.ok) {
        setAuthenticated(true)
        return true
      } else {
        setAuthenticated(false)
        return false
      }
    } catch (err) {
      setAuthenticated(false)
      return false
    } finally {
      setChecking(false)
    }
  }, [])

  const connectWebSocket = useCallback(() => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

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
        if (msg.tabs.length > 0 && (!activeTabId || activeTabId === 'default')) {
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
      // Only reconnect if we're still authenticated and not manually closing
      if (authenticated && wsRef.current === ws) {
        setTimeout(() => {
          if (authenticated) {
            connectWebSocket()
          }
        }, 3000)
      }
    }

    wsRef.current = ws
  }, [authenticated])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ password }),
      })

      if (response.ok) {
        setAuthenticated(true)
        connectWebSocket()
      } else {
        setError('Invalid password')
      }
    } catch (err) {
      setError('Connection failed')
    }
  }

  const handleLogout = async () => {
    try {
      await fetch('/api/auth', {
        method: 'DELETE',
        credentials: 'include'
      })
      
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      
      setAuthenticated(false)
      setConnected(false)
      setTabs([])
      setPassword('') // Clear password
      setActiveTabId('default')
    } catch (err) {
      console.error('Logout failed:', err)
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
      const response = await fetch(`/api/history?tabId=${activeTabId}`, {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        setHistory(data || [])
        setShowHistory(true)
      } else if (response.status === 401) {
        setAuthenticated(false)
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
      const response = await fetch('/api/snapshots', {
        credentials: 'include'
      })
      if (response.ok) {
        const data = await response.json()
        setSnapshots(data || [])
        setShowSnapshots(true)
      } else if (response.status === 401) {
        setAuthenticated(false)
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
        credentials: 'include',
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
      } else if (response.status === 401) {
        setAuthenticated(false)
      }
    } catch (err) {
      console.error('Failed to create snapshot:', err)
    }
  }

  const restoreSnapshot = (snapshot: SnapshotRecord) => {
    try {
      const tabs = JSON.parse(snapshot.tabs_data)
      if (confirm(`Restore snapshot "${snapshot.name}"? This will replace all current tabs.`)) {
        tabs.forEach((tab: Tab, index: number) => {
          if (index === 0) {
            const msg: Message = {
              type: 'update',
              tabId: tab.id,
              content: tab.content,
            }
            wsRef.current?.send(JSON.stringify(msg))
          } else {
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
        credentials: 'include',
        body: formData,
      })

      if (response.ok) {
        const data = await response.json()
        const imageMarkdown = `![${file.name}](${data.imageUrl})\n`
        const currentContent = activeTab?.content || ''
        handleEditorChange(currentContent + imageMarkdown)
      } else if (response.status === 401) {
        setAuthenticated(false)
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
    checkAuth().then(isAuth => {
      if (isAuth) {
        connectWebSocket()
      }
    })
  }, [])

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => {
      document.removeEventListener('paste', handlePaste)
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [activeTab])

  if (checking) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

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
      {/* Status Bar - Line 1 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-800">BoardCast</h1>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm text-gray-600">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <button
          onClick={handleLogout}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition flex items-center space-x-2"
        >
          <span>Logout</span>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>

      {/* Action Bar - Line 2 */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center space-x-3 shadow-sm">
        <button
          onClick={loadHistory}
          className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-medium hover:bg-blue-200 transition"
          title="View history"
        >
          History
        </button>
        <button
          onClick={loadSnapshots}
          className="px-4 py-2 bg-purple-100 text-purple-700 rounded-lg font-medium hover:bg-purple-200 transition"
          title="Manage snapshots"
        >
          Snapshots
        </button>
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
          onClick={() => setPreviewMode(!previewMode)}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            previewMode
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          title="Toggle preview"
        >
          {previewMode ? 'Edit' : 'Preview'}
        </button>
        <button
          onClick={clearCurrentTab}
          className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition"
          title="Clear current tab"
        >
          Clear
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <div className="p-4">
            <button
              onClick={createNewTab}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition shadow-sm mb-4"
            >
              + New Tab
            </button>
            
            <div className="space-y-2">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`group relative p-3 rounded-lg cursor-pointer transition ${
                    activeTabId === tab.id
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {editingTabId === tab.id ? (
                    <input
                      type="text"
                      value={editingTabName}
                      onChange={(e) => setEditingTabName(e.target.value)}
                      onBlur={() => renameTab(tab.id, editingTabName)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          renameTab(tab.id, editingTabName)
                        }
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {tab.name}
                      </span>
                      <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingTabId(tab.id)
                            setEditingTabName(tab.name)
                          }}
                          className="p-1 text-gray-600 hover:text-blue-600 rounded"
                          title="Rename"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {tabs.length > 1 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteTab(tab.id)
                            }}
                            className="p-1 text-gray-600 hover:text-red-600 rounded"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Editor/Preview Area */}
        <div className="flex-1 relative">
          {previewMode ? (
            <div className="h-full overflow-auto p-8 bg-white">
              <div className="max-w-4xl mx-auto prose prose-lg">
                <ReactMarkdown>{activeTab?.content || ''}</ReactMarkdown>
              </div>
            </div>
          ) : (
            <Editor
              key={activeTabId}
              height="100%"
              defaultLanguage="markdown"
              value={activeTab?.content || ''}
              onChange={handleEditorChange}
              theme="vs-light"
              options={{
                fontSize: 14,
                wordWrap: 'on',
                minimap: { enabled: false },
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
              }}
              onMount={(editor) => {
                editorRef.current = editor
              }}
            />
          )}
        </div>
      </div>

      {/* Bottom Status Bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-2 flex items-center justify-between text-sm text-gray-600">
        <div className="flex items-center space-x-4">
          <span>Tab: {activeTab?.name || 'None'}</span>
          <span>Characters: {activeTab?.content?.length || 0}</span>
          <span>Lines: {(activeTab?.content?.split('\n').length || 0)}</span>
        </div>
        <div className="flex items-center space-x-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">History</h2>
              <button
                onClick={() => setShowHistory(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-120px)] p-6">
              {history.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No history available</p>
              ) : (
                <div className="space-y-3">
                  {history.map(record => (
                    <div
                      key={record.id}
                      className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition"
                      onClick={() => restoreHistory(record)}
                    >
                      <div className="text-sm text-gray-600 mb-2">
                        {new Date(record.created).toLocaleString()}
                      </div>
                      <div className="text-sm text-gray-800 line-clamp-2">
                        {record.content.substring(0, 100)}...
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Snapshots Modal */}
      {showSnapshots && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-800">Snapshots</h2>
              <button
                onClick={() => setShowSnapshots(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto max-h-[calc(80vh-120px)] p-6">
              <div className="mb-6 space-y-3">
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="Snapshot name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <input
                  type="text"
                  value={snapshotDesc}
                  onChange={(e) => setSnapshotDesc(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                <button
                  onClick={createSnapshot}
                  className="w-full px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 transition"
                >
                  Create Snapshot
                </button>
              </div>

              {snapshots.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No snapshots available</p>
              ) : (
                <div className="space-y-3">
                  {snapshots.map(snapshot => (
                    <div
                      key={snapshot.id}
                      className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition"
                      onClick={() => restoreSnapshot(snapshot)}
                    >
                      <div className="font-medium text-gray-800 mb-1">{snapshot.name}</div>
                      {snapshot.description && (
                        <div className="text-sm text-gray-600 mb-2">{snapshot.description}</div>
                      )}
                      <div className="text-xs text-gray-500">
                        {new Date(snapshot.created).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
