import { useState } from 'react'
import heroImg from './assets/hero.png'
import reactLogo from './assets/react.svg'
import viteLogo from './assets/vite.svg'
import './App.css'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      <div>
        <p className="mt-4 text-lg text-red-500"> Hi ! folk this is tailwind</p>
      </div>
    </>
  )
}

export default App
