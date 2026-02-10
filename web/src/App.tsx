import { useState, useEffect, useRef, useCallback } from 'react'
import Editor from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'

interface Message {
  type: string
  content: string
  token?: string
}

function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [content, setContent] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const [connected, setConnected] = useState(false)
  const [activeUsers, setActiveUsers] = useState(1)
  const [error, setError] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const editorRef = useRef<any>(null)

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
      if (msg.type === 'sync' || msg.type === 'update') {
        setContent(msg.content)
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
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (authenticated) {
          connectWebSocket()
        }
      }, 3000)
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

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && wsRef.current?.readyState === WebSocket.OPEN) {
      const msg: Message = {
        type: 'update',
        content: value,
      }
      wsRef.current.send(JSON.stringify(msg))
      setContent(value)
    }
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [])

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
            <p>💎 Secure single-user whiteboard</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
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
          <div className="text-sm text-gray-600">
            {activeUsers} {activeUsers === 1 ? 'user' : 'users'} online
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
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
            onClick={() => {
              setContent('')
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'update', content: '' }))
              }
            }}
            className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-medium hover:bg-red-200 transition"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        {previewMode ? (
          <div className="h-full overflow-auto bg-white p-8">
            <div className="max-w-4xl mx-auto prose prose-lg">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="markdown"
            value={content}
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

      {/* Status Bar */}
      <div className="bg-white border-t border-gray-200 px-6 py-2 flex items-center justify-between text-sm text-gray-600">
        <div>
          Markdown supported • {content.length} characters
        </div>
        <div>
          Press <kbd className="px-2 py-1 bg-gray-100 rounded text-xs">Ctrl+S</kbd> to save (auto-synced)
        </div>
      </div>
    </div>
  )
}

export default App
