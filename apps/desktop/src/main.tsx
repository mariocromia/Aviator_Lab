import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { BetSimulatorWindow } from './pages/bet-simulator-window';
import './styles.css';

const simulatorWindow = window.location.hash.startsWith('#/bet-simulator');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{simulatorWindow?<BetSimulatorWindow/>:<HashRouter><App /></HashRouter>}</React.StrictMode>
);
