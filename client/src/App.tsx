import { useEffect, useState } from 'react'

function App() {
  const [message, setMessage] = useState('Loading...')

  useEffect(() => {
    fetch('/api/hello')
      .then((res) => res.json())
      .then((data) => setMessage(data.message))
      .catch(() => setMessage('Failed to reach the server'))
  }, [])

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-900 text-white">
      <div className="rounded-lg border border-gray-700 px-8 py-6 text-center">
        <h1 className="text-2xl font-semibold">Valorant Tracker</h1>
        <p className="mt-2 text-gray-300">{message}</p>
      </div>
    </div>
  )
}

export default App
