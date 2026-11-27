import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./index.css";
import Layout from "./components/Layout";
import ROList from "./pages/ROList";
import RODetail from "./pages/RODetail";
import NewRO from "./pages/NewRO";
import Customer from "./pages/Customer";
import Dashboard from "./pages/Dashboard";
import Network from "./pages/Network";
import Rules from "./pages/Rules";
import Audit from "./pages/Audit";
import Book from "./pages/Book";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/c/:token" element={<Customer />} />
        <Route path="/book" element={<Book />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/ros" replace />} />
          <Route path="/ros" element={<ROList />} />
          <Route path="/ros/new" element={<NewRO />} />
          <Route path="/ros/:id" element={<RODetail />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/network" element={<Network />} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="*" element={<Navigate to="/ros" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
