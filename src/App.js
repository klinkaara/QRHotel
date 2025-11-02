import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CustomerMenu from './pages/CustomerMenu';
import KitchenDashboard from './pages/KitchenDashboard';
import OwnerDashboard from './pages/OwnerDashboard';
import WaiterDashboard from './pages/WaiterDashboard';
import './App.css'; // <-- ADD THIS LINE HERE

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<CustomerMenu />} />
        <Route path="/kitchen" element={<KitchenDashboard />} />
        <Route path="/owner" element={<OwnerDashboard />} />
        <Route path="/waiter" element={<WaiterDashboard />} />
      </Routes>
    </Router>
  );
}