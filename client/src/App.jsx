import { useState, useEffect } from 'react';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg'
import './App.css';
import axios from "axios";
import LiveSpeechToText from './components/LiveSpeechToText';
import AuthForm from './components/AuthForm';
import PayFassets from './components/PayFassets';

function App() {
  const [count, setCount] = useState(0);

  const fetchApi = async () => {
    const response = await axios.get("http://localhost:5000/api");
    console.log(response.data.fruits);
  }

  useEffect(() => {
    fetchApi();
  },[]);

  return (
    <>
    <AuthForm/>
    <PayFassets/>
    </>

  )
}

export default App
