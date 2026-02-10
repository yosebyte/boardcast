import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'

interface Tab {
  id: string
  name: string
  content: string
}

interface Message {
  type: string
  tabId?: string
  content?: string
  name?: string
  tabs?: Tab[]
}

type ThemeMode = 'system' | 'light' | 'dark'

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [password, setPassword] = useState('')
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('default')
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [editingTabId, setEditingTabId] = useState<string | null>(null)
  const [editingTabName, setEditingTabName] = useState('')
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('fontSize')
    return saved ? parseInt(saved) : 14
  })
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as ThemeMode) || 'system'
  })
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null)
  const editorRef = useRef<any>(null)
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null)
  const isLocalUpdateRef = useRef(false)

  // Get effective theme based on mode and system preference
  const getEffectiveTheme = useCallback(() => {
    if (themeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return themeMode
  }, [themeMode])

  const [effectiveTheme, setEffectiveTheme] = useState(getEffectiveTheme())

  useEffect(() => {
    const updateTheme = () => {
      setEffectiveTheme(getEffectiveTheme())
    }

    updateTheme()
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    mediaQuery.addEventListener('change', updateTheme)

    return () => mediaQuery.removeEventListener('change', updateTheme)
  }, [themeMode, getEffectiveTheme])

  const cycleTheme = () => {
    const modes: ThemeMode[] = ['system', 'light', 'dark']
    const currentIndex = modes.indexOf(themeMode)
    const nextMode = modes[(currentIndex + 1) % modes.length]
    setThemeMode(nextMode)
    localStorage.setItem('theme', nextMode)
  }

  const increaseFontSize = () => {
    const newSize = Math.min(fontSize + 2, 32)
    setFontSize(newSize)
    localStorage.setItem('fontSize', newSize.toString())
  }

  const decreaseFontSize = () => {
    const newSize = Math.max(fontSize - 2, 10)
    setFontSize(newSize)
    localStorage.setItem('fontSize', newSize.toString())
  }

  const getThemeIcon = () => {
    if (themeMode === 'system') {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    } else if (themeMode === 'light') {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      )
    } else {
      return (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      )
    }
  }

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
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`)

    ws.onopen = () => {
      setConnected(true)
      setError('')
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
    }

    ws.onmessage = (event) => {
      const msg: Message = JSON.parse(event.data)
      
      if (msg.type === 'init' && msg.tabs) {
        setTabs(msg.tabs)
        if (msg.tabs.length > 0) {
          setActiveTabId(msg.tabs[0].id)
        }
      } else if (msg.type === 'update' && msg.tabId) {
        // Don't update if user is currently editing this tab
        if (!isLocalUpdateRef.current || msg.tabId !== activeTabId) {
          setTabs(prev => prev.map(tab =>
            tab.id === msg.tabId ? { ...tab, content: msg.content || '' } : tab
          ))
        }
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

    ws.onerror = () => {
      setError('Connection error')
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
    }

    wsRef.current = ws
  }, [activeTabId])

  useEffect(() => {
    if (!authenticated) return

    if (!connected && !wsRef.current) {
      reconnectTimerRef.current = setTimeout(() => {
        connectWebSocket()
      }, 3000)
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
      }
    }
  }, [authenticated, connected, connectWebSocket])

  useEffect(() => {
    if (authenticated && !wsRef.current) {
      connectWebSocket()
    }

    return () => {
      if (!authenticated && wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [authenticated, connectWebSocket])

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
      
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      
      setAuthenticated(false)
      setConnected(false)
      setTabs([])
      setPassword('')
      setActiveTabId('default')
    } catch (err) {
      console.error('Logout failed:', err)
    }
  }

  // Debounced update to reduce WebSocket messages and prevent cursor jumping
  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return

    // Save cursor position
    const editor = editorRef.current
    const position = editor?.getPosition()
    const scrollTop = editor?.getScrollTop()

    // Mark as local update to prevent WebSocket echo
    isLocalUpdateRef.current = true

    // Update local state immediately for smooth typing
    setTabs(prev => prev.map(tab =>
      tab.id === activeTabId ? { ...tab, content: value } : tab
    ))

    // Restore cursor position after state update
    requestAnimationFrame(() => {
      if (editor && position) {
        editor.setPosition(position)
        if (scrollTop !== undefined) {
          editor.setScrollTop(scrollTop)
        }
      }
    })

    // Debounce WebSocket updates
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current)
    }

    updateTimerRef.current = setTimeout(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const msg: Message = {
          type: 'update',
          tabId: activeTabId,
          content: value,
        }
        wsRef.current.send(JSON.stringify(msg))
      }
      // Allow WebSocket updates again after sending
      setTimeout(() => {
        isLocalUpdateRef.current = false
      }, 100)
    }, 500) // 500ms debounce
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
    } else {
      alert('Not connected to server')
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

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

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
    <div className={`h-screen flex flex-col ${effectiveTheme === 'dark' ? 'bg-[#1e1e1e]' : 'bg-gray-50'}`}>
      {/* Top Header Bar */}
      <div className={`${effectiveTheme === 'dark' ? 'bg-[#2d2d30] border-[#3e3e42]' : 'bg-white border-gray-200'} border-b px-6 py-3 flex items-center justify-between shadow-sm`}>
        <div className="flex items-center space-x-4">
          <h1 className={`text-xl font-bold ${effectiveTheme === 'dark' ? 'text-gray-100' : 'text-gray-800'}`}>BoardCast</h1>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`text-sm ${effectiveTheme === 'dark' ? 'text-gray-300' : 'text-gray-600'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button
            onClick={decreaseFontSize}
            className={`p-2 rounded-lg transition ${
              effectiveTheme === 'dark'
                ? 'bg-[#3e3e42] text-gray-300 hover:bg-[#4e4e52]'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Decrease font size"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
            </svg>
          </button>
          
          <button
            onClick={increaseFontSize}
            className={`p-2 rounded-lg transition ${
              effectiveTheme === 'dark'
                ? 'bg-[#3e3e42] text-gray-300 hover:bg-[#4e4e52]'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Increase font size"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          
          <button
            onClick={cycleTheme}
            className={`p-2 rounded-lg transition ${
              effectiveTheme === 'dark'
                ? 'bg-[#3e3e42] text-gray-300 hover:bg-[#4e4e52]'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title={`Theme: ${themeMode} (click to cycle)`}
          >
            {getThemeIcon()}
          </button>
          
          <button
            onClick={handleLogout}
            className={`p-2 rounded-lg transition ${
              effectiveTheme === 'dark'
                ? 'bg-[#3e3e42] text-gray-300 hover:bg-[#4e4e52]'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
            title="Logout"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <div className={`w-64 border-r overflow-y-auto ${
            effectiveTheme === 'dark' 
              ? 'bg-[#252526] border-[#3e3e42]' 
              : 'bg-white border-gray-200'
          }`}>
            <div className="p-4">
              <button
                onClick={createNewTab}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition shadow-sm mb-4 text-sm"
              >
                + New Tab
              </button>
              
              <div className="space-y-2">
                {tabs.map(tab => (
                  <div
                    key={tab.id}
                    className={`group relative p-3 rounded-lg cursor-pointer transition ${
                      activeTabId === tab.id
                        ? effectiveTheme === 'dark'
                          ? 'bg-[#37373d] border-2 border-blue-500'
                          : 'bg-blue-50 border-2 border-blue-500'
                        : effectiveTheme === 'dark'
                          ? 'bg-[#2d2d30] border-2 border-transparent hover:bg-[#37373d]'
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
                        <span className={`text-sm font-medium truncate ${
                          effectiveTheme === 'dark' ? 'text-gray-200' : 'text-gray-800'
                        }`}>
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

          {/* Editor */}
          <div className="flex-1">
            <Editor
              key={activeTabId}
              height="100%"
              defaultLanguage="markdown"
              value={activeTab?.content || ''}
              onChange={handleEditorChange}
              theme={effectiveTheme === 'dark' ? 'vs-dark' : 'vs-light'}
              options={{
                fontSize: fontSize,
                wordWrap: 'on',
                minimap: { enabled: false },
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
                automaticLayout: true,
                glyphMargin: false,
                folding: false,
                quickSuggestions: false,
                suggestOnTriggerCharacters: false,
                acceptSuggestionOnEnter: 'off',
                tabCompletion: 'off',
                wordBasedSuggestions: false,
                parameterHints: { enabled: false },
                snippetSuggestions: 'none',
                renderWhitespace: 'none',
                renderLineHighlight: 'line',
              }}
              onMount={(editor) => {
                editorRef.current = editor
              }}
            />
          </div>
        </div>

        {/* Bottom Status Bar */}
        <div className={`border-t px-6 py-2 flex items-center justify-between text-sm ${
          effectiveTheme === 'dark'
            ? 'bg-[#007acc] border-[#007acc] text-white'
            : 'bg-blue-600 border-blue-600 text-white'
        }`}>
          <div className="flex items-center space-x-4">
            <span>Tab: {activeTab?.name || 'None'}</span>
            <span>Lines: {(activeTab?.content?.split('\n').length || 0)}</span>
            <span>Characters: {activeTab?.content?.length || 0}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span>Font: {fontSize}px</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
