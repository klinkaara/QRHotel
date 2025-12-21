"use client"
import {useEffect, useState, useRef} from "react"
import {db} from "../firebase"
import {collection, onSnapshot, doc, updateDoc, getDocs, query, where, deleteDoc} from "firebase/firestore"
import LoadingSpinner from "../data/loading-spinner"
import {writeBatch} from "firebase/firestore"
import { useMemo } from "react"



export default function KitchenDashboard() {
    const [kitchenOrders, setKitchenOrders] = useState([])
    const [loading, setLoading] = useState(false)
    const [connectionStatus, setConnectionStatus] = useState("connected")
    const [newOrderAlert, setNewOrderAlert] = useState(null)
    // Refs for tracking previous states to detect new orders
    const prevKitchenOrdersRef = useRef([])
    const audioRef = useRef(null)

    const [headerVisible, setHeaderVisible] = useState(true)
    const lastScrollY = useRef(0)
    const headerRef = useRef(null)

    // Initialize audio for notifications
    useEffect(() => {
        audioRef.current = new Audio(
            "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT",
        )
    }, [])

    useEffect(() => {
        const handleScroll = () => {
            if (headerRef.current) {
                const currentScrollY = window.scrollY
                const headerHeight = headerRef.current.offsetHeight

                if (currentScrollY > lastScrollY.current && currentScrollY > headerHeight) {
                    // Scrolling down past header height
                    setHeaderVisible(false)
                } else if (currentScrollY < lastScrollY.current) {
                    // Scrolling up
                    setHeaderVisible(true)
                }
                lastScrollY.current = currentScrollY
            }
        }

        window.addEventListener("scroll", handleScroll)
        return () => window.removeEventListener("scroll", handleScroll)
    }, [])

    // Function to show new order notification
    const showNewOrderNotification = (orderData) => {
        setNewOrderAlert({
            message: `🔔 New kitchen order for Table ${orderData.table}!`,
            timestamp: Date.now(),
        })
        // Play notification sound
        if (audioRef.current) {
            audioRef.current.play().catch((e) => console.log("Audio play failed:", e))
        }
        // Auto-hide notification after 5 seconds
        setTimeout(() => {
            setNewOrderAlert(null)
        }, 5000)
    }
    // Enhanced listener for kitchen orders with new order detection
  useEffect(() => {
    setConnectionStatus("connecting")

    const unsubscribe = onSnapshot(
        query(
            collection(db, "kitchenOrders"),
            where("status", "in", ["Pending", "Preparing", "Ready"])
        ),
        (snapshot) => {
          const orders = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))

          const prevOrders = prevKitchenOrdersRef.current
          const newOrders = orders.filter(
              (order) =>
                  !prevOrders.find((p) => p.id === order.id) &&
                  ["Pending", "Preparing", "Ready"].includes(order.status)
          )

          if (newOrders.length && prevOrders.length) {
            newOrders.forEach(showNewOrderNotification)
          }

          const sorted = orders.sort((a, b) => b.receivedAt - a.receivedAt)
          setKitchenOrders(sorted)
          prevKitchenOrdersRef.current = sorted
          setConnectionStatus("connected")
        },
        () => setConnectionStatus("error")
    )

    return () => unsubscribe()
  }, [])

  const updateOrderStatus = async (orderId, newStatus) => {
        setLoading(true)

        try {
            // 1️⃣ Update kitchenOrders status
            await updateDoc(doc(db, "kitchenOrders", orderId), {
                status: newStatus,
                updatedAt: new Date(),
            })

            const order = kitchenOrders.find((o) => o.id === orderId)
            if (!order || !order.originalOrderId) return

            // 2️⃣ Update mergedOrders
            await updateDoc(doc(db, "mergedOrders", order.originalOrderId), {
                kitchenStatus: newStatus,
                kitchenUpdatedAt: new Date(),
            })

            // 3️⃣ Batch update individualItems (FAST)
            const batch = writeBatch(db)

            for (const itemToUpdate of order.items || []) {
                const q = query(
                    collection(db, "individualItems"),
                    where("sessionId", "==", order.originalOrderId),
                    where("table", "==", order.table),
                    where("itemName", "==", itemToUpdate.name),
                    where("kitchenStatus", "!=", "Canceled"),
                )

                const snap = await getDocs(q)
                let updatedCount = 0

                for (const docSnap of snap.docs) {
                    if (updatedCount >= itemToUpdate.qty) break

                    batch.update(doc(db, "individualItems", docSnap.id), {
                        kitchenStatus: newStatus,
                        updated: new Date(),
                    })

                    updatedCount++
                }
            }

            await batch.commit()

        } catch (error) {
            console.error("Failed to update status:", error)
        } finally {
            setTimeout(() => setLoading(false), 300)
        }
    }

    const clearAllOrders = async () => {
        if (!window.confirm("Are you sure you want to clear all kitchen orders? This is typically done at end of day.")) {
            return
        }
        setLoading(true)
        try {
            const kitchenOrdersSnap = await getDocs(collection(db, "kitchenOrders"))
            for (const orderDoc of kitchenOrdersSnap.docs) {
                await deleteDoc(doc(db, "kitchenOrders", orderDoc.id))
            }
            console.log("✅ All kitchen orders cleared successfully.")
        } catch (error) {
            console.error("Failed to clear orders:", error)
        } finally {
            setLoading(false)
        }
    }
    const formatTime = (timestamp) => {
        if (!timestamp) return ""
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        return date.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})
    }
    const getTimeDifference = (timestamp) => {
        if (!timestamp) return ""
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
        const now = new Date()
        const diffMinutes = Math.floor((now - date) / (1000 * 60))
        if (diffMinutes < 1) return "Just now"
        if (diffMinutes === 1) return "1 min ago"
        return `${diffMinutes} mins ago`
    }
    const getStatusColor = (status) => {
        switch (status) {
            case "Pending":
                return "#ffc107"
            case "Preparing":
                return "#17a2b8"
            case "Ready":
                return "#28a745"
            default:
                return "#6c757d"
        }
    }
    const getStatusTextColor = (status) => {
        return status === "Pending" ? "#000" : "white"
    }
    const getOrderNumberForTable = (order) => {
        const tableOrders = kitchenOrders.filter((o) => o.table === order.table).sort((a, b) => a.receivedAt - b.receivedAt)
        const orderIndex = tableOrders.findIndex((o) => o.id === order.id)
        return orderIndex + 1
    }
    // Calculate counts for different statuses
  const pendingOrdersCount = useMemo(
      () => kitchenOrders.filter((o) => o.status === "Pending").length,
      [kitchenOrders]
  )

  const readyOrdersCount = useMemo(
      () => kitchenOrders.filter((o) => o.status === "Ready").length,
      [kitchenOrders]
  )

  return (
        <div className="kitchen-dashboard">
            {loading && <LoadingSpinner/>}
            {/* Connection Status Indicator */}
            <div className={`connection-status ${connectionStatus}`}>
                <div className="status-indicator">
                    {connectionStatus === "connected" && "🟢 Live Updates Active"}
                    {connectionStatus === "connecting" && "🟡 Connecting..."}
                    {connectionStatus === "error" && "🔴 Connection Error"}
                </div>
            </div>
            {/* New Order Alert */}
            {newOrderAlert && (
                <div className="new-order-alert">
                    <div className="alert-content">
                        <span className="alert-icon">🔔</span>
                        <span className="alert-message">{newOrderAlert.message}</span>
                        <button className="alert-close" onClick={() => setNewOrderAlert(null)}>
                            ×
                        </button>
                    </div>
                </div>
            )}
            {/* Enhanced Header */}
            <div
                ref={headerRef} // Added ref to header
                className="header"
                style={{
                    transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
                    transition: "transform 0.3s ease-in-out", // Added transition for smooth hide/show
                }}
            >
                {/* </CHANGE> */}
                <div className="header-content">
                    <div className="header-top">
                        <div className="header-title">
                            <h1>
                                <img
                                    src="/logo.png" // Updated image source to public/logo.png
                                    width="150"
                                    height="150"
                                    alt="Restaurant logo"
                                    style={{verticalAlign: "middle", marginRight: "10px"}}
                                />
                                {/* </CHANGE> */}
                                Kitchen Dashboard
                            </h1>
                            <p>Prepare orders • {kitchenOrders.length} active orders • Live Updates</p>
                        </div>
                        <button onClick={clearAllOrders} className="clear-all-btn">
                            🗑️ Clear All Orders
                        </button>
                    </div>
                    {/* Stats Row */}
                    <div className="stats-grid">
                        <div className="stat-card active-orders">
                            <div className="stat-number">{kitchenOrders.length}</div>
                            <div className="stat-label">Active Orders</div>
                        </div>
                        <div className="stat-card pending-orders">
                            <div className="stat-number">{pendingOrdersCount}</div>
                            <div className="stat-label">Pending Orders</div>
                        </div>
                        <div className="stat-card ready-orders">
                            <div className="stat-number">{readyOrdersCount}</div>
                            <div className="stat-label">Ready Orders</div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="main-content">
                {kitchenOrders.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">🍽️</div>
                        <h3>No Active Orders</h3>
                        <p>Waiting for waiters to send orders to kitchen...</p>
                    </div>
                ) : (
                    <div className="orders-grid">
                        {kitchenOrders.map((order) => (
                            <div
                                key={order.id}
                                className="order-card"
                                style={{
                                    borderColor: getStatusColor(order.status),
                                }}
                            >
                                {/* Header */}
                                <div className="order-header">
                                    <div className="order-info">
                                        <h3 className="order-title">
                                            🍽️ Table {order.table} - Order #{getOrderNumberForTable(order)}
                                        </h3>
                                        {order.customerNames && order.customerNames.length > 0 && (
                                            <div className="customer-names">👥 {order.customerNames.join(", ")}</div>
                                        )}
                                        <div className="order-time">
                                            📅 {formatTime(order.receivedAt)} ({getTimeDifference(order.receivedAt)})
                                        </div>
                                        <div className="items-count">📦 {order.items.length} items in this order</div>
                                    </div>
                                    <div className="status-badge-container">
                    <span
                        className="status-badge"
                        style={{
                            backgroundColor: getStatusColor(order.status),
                            color: getStatusTextColor(order.status),
                        }}
                    >
                      {order.status.toUpperCase()}
                    </span>
                                    </div>
                                </div>
                                {/* Items to Prepare */}
                                <div className="items-section">
                                    <h4 className="items-title">📋 Items to Prepare:</h4>
                                    <div className="items-container">
                                        {order.items.map((item, idx) => (
                                            <div
                                                key={idx}
                                                className="item-row"
                                                style={{
                                                    borderBottom: idx < order.items.length - 1 ? "2px solid #dee2e6" : "none",
                                                }}
                                            >
                                                <div className="item-name">{item.name}</div>
                                                <div className="item-quantity">
                                                    <span className="quantity-badge">× {item.qty}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                {/* Action Buttons */}
                                <div className="action-buttons">
                                    {order.status === "Pending" && (
                                        <button
                                            onClick={() => updateOrderStatus(order.id, "Preparing")}
                                            className="action-btn preparing-btn"
                                        >
                                            🔥 Start Preparing
                                        </button>
                                    )}
                                    {order.status === "Preparing" && (
                                        <button onClick={() => updateOrderStatus(order.id, "Ready")}
                                                className="action-btn ready-btn">
                                            ✅ Mark Ready
                                        </button>
                                    )}
                                    {order.status === "Ready" &&
                                        <div className="ready-status">🎉 Ready for Pickup!</div>}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
            <style jsx>{`
        .kitchen-dashboard {
          min-height: 100vh;
          background-color: #f8f9fa;
        }
        /* Removed .logo-header entirely */
        .connection-status {
          position: fixed;
          top: 10px; /* Adjusted for no logo header */
          right: 10px;
          z-index: 1001;
          padding: 8px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
        }
        .connection-status.connected {
          background-color: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }
        .connection-status.connecting {
          background-color: #fff3cd;
          color: #856404;
          border: 1px solid #ffeaa7;
        }
        .connection-status.error {
          background-color: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }
        .new-order-alert {
          position: fixed;
          top: 80px; /* Adjusted for no logo header */
          right: 10px;
          z-index: 1002;
          background-color: #ff6b6b;
          color: white;
          padding: 15px;
          border-radius: 10px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          animation: slideInRight 0.5s ease-out, pulse 2s infinite;
          max-width: 300px;
        }
        .alert-content {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .alert-icon {
          font-size: 20px;
          animation: bounce 1s infinite;
        }
        .alert-message {
          flex: 1;
          font-weight: bold;
        }
        .alert-close {
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: background-color 0.3s ease;
        }
        .alert-close:hover {
          background-color: rgba(255, 255, 255, 0.2);
        }
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes bounce {
          0%,
          20%,
          50%,
          80%,
          100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-10px);
          }
          60% {
            transform: translateY(-5px);
          }
        }
        .header {
          background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
          color: white;
          padding: 20px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          position: sticky;
          top: 0; /* Adjusted for no logo header */
          z-index: 1000;
          margin-top: 0; /* Adjusted for no logo header */
        }
        .header-content {
          max-width: 1200px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 10px;
        }
        .header-title h1 {
          margin: 0;
          font-size: clamp(1.5rem, 4vw, 2.5rem);
          font-weight: bold;
          text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
          display: flex; /* Added to align image and text */
          align-items: center; /* Added to align image and text */
        }
        .header-title p {
          margin: 5px 0 0 0;
          opacity: 0.9;
          font-size: clamp(0.8rem, 2vw, 1rem);
        }
        .clear-all-btn {
          padding: 12px 20px;
          background-color: #dc3545;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          transition: all 0.3s ease;
          min-width: 140px;
        }
        .clear-all-btn:hover {
          background-color: #c82333;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 15px;
          margin-top: 10px;
        }
        .stat-card {
          padding: 15px;
          border-radius: 10px;
          text-align: center;
          backdrop-filter: blur(10px);
        }
        .active-orders {
          background-color: rgba(0, 123, 255, 0.2);
        }
        .pending-orders {
          background-color: rgba(255, 193, 7, 0.2);
        }
        .ready-orders {
          background-color: rgba(40, 167, 69, 0.2);
        }
        .stat-number {
          font-size: 24px;
          font-weight: bold;
        }
        .stat-label {
          font-size: 12px;
          opacity: 0.9;
        }
        .main-content {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .empty-state {
          text-align: center;
          padding: 60px 20px;
          background-color: white;
          border-radius: 15px;
          color: #6c757d;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        .empty-icon {
          font-size: 48px;
          margin-bottom: 20px;
        }
        .empty-state h3 {
          margin: 0 0 10px 0;
          font-size: clamp(1.2rem, 3vw, 1.5rem);
        }
        .empty-state p {
          margin: 0;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
        }
        .orders-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .order-card {
          border: 3px solid;
          border-radius: 15px;
          padding: 20px;
          background-color: white;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
        }
        .order-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
        }
        .order-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 15px;
          flex-wrap: wrap;
          gap: 10px;
        }
        .order-info {
          flex: 1;
          min-width: 200px;
        }
        .order-title {
          margin: 0 0 5px 0;
          color: #007bff;
          font-size: clamp(1.1rem, 3vw, 1.5rem);
        }
        .customer-names {
          font-size: 14px;
          color: #6c757d;
          margin-bottom: 5px;
        }
        .order-time {
          font-size: 12px;
          color: #6c757d;
          margin-bottom: 5px;
        }
        .items-count {
          font-size: 12px;
          color: #28a745;
          font-weight: bold;
        }
        .status-badge-container {
          text-align: right;
          min-width: 120px;
        }
        .status-badge {
          padding: 8px 16px;
          border-radius: 25px;
          font-size: 14px;
          font-weight: bold;
          display: inline-block;
        }
        .items-section {
          margin-bottom: 20px;
        }
        .items-title {
          margin: 0 0 15px 0;
          color: #333;
          font-size: clamp(1rem, 2.5vw, 1.2rem);
        }
        .items-container {
          background-color: #f8f9fa;
          border-radius: 10px;
          padding: 15px;
        }
        .item-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
        }
        .item-name {
          font-weight: bold;
          font-size: clamp(1rem, 2.5vw, 1.2rem);
          color: #333;
          flex: 1;
        }
        .item-quantity {
          text-align: right;
        }
        .quantity-badge {
          background-color: #007bff;
          color: white;
          padding: 6px 12px;
          border-radius: 15px;
          font-size: clamp(0.9rem, 2vw, 1rem);
          font-weight: bold;
        }
        .action-buttons {
          display: flex;
          gap: 10px;
        }
        .action-btn {
          flex: 1;
          padding: 15px 20px;
          color: white;
          border: none;
          border-radius: 10px;
          cursor: pointer;
          font-weight: bold;
          font-size: clamp(0.9rem, 2vw, 1rem);
          transition: all 0.3s ease;
        }
        .preparing-btn {
          background-color: #17a2b8;
        }
        .preparing-btn:hover {
          background-color: #138496;
        }
        .ready-btn {
          background-color: #28a745;
        }
        .ready-btn:hover {
          background-color: #218838;
        }
        .ready-status {
          flex: 1;
          padding: 15px 20px;
          background-color: #28a745;
          color: white;
          border-radius: 10px;
          text-align: center;
          font-weight: bold;
          font-size: clamp(0.9rem, 2vw, 1rem);
        }
        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
          .connection-status {
            position: relative;
            top: 0;
            right: 0;
            margin-bottom: 10px;
            text-align: center;
          }
          .new-order-alert {
            position: relative;
            top: 0;
            right: 0;
            margin-bottom: 15px;
            max-width: 100%;
          }
          .header {
            padding: 15px;
            margin-top: 0; /* Adjusted for no logo header */
            top: 0; /* Adjusted for no logo header */
          }
          .header-top {
            flex-direction: column;
            align-items: stretch;
            gap: 15px;
          }
          .clear-all-btn {
            width: 100%;
            min-width: unset;
          }
          .stats-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }
          .stat-card {
            padding: 12px;
          }
          .stat-number {
            font-size: 20px;
          }
          .stat-label {
            font-size: 11px;
          }
          .main-content {
            padding: 15px;
          }
          .orders-grid {
            grid-template-columns: 1fr;
            gap: 15px;
          }
          .order-header {
            flex-direction: column;
            gap: 15px;
          }
          .order-info {
            flex: 1;
            min-width: 200px;
          }
          .status-badge-container {
            text-align: left;
            min-width: 120px;
          }
          .order-card {
            padding: 15px;
          }
          .items-container {
            padding: 12px;
          }
          .item-row {
            padding: 10px 0;
            flex-wrap: wrap;
            gap: 8px;
          }
          .item-name {
            min-width: 100%;
            margin-bottom: 5px;
          }
          .item-quantity {
            text-align: left;
          }
          .action-buttons {
            flex-direction: column;
            gap: 12px;
          }
          .action-btn,
          .ready-status {
            padding: 12px 16px;
          }
        }
        @media (max-width: 480px) {
          .header {
            padding: 10px;
            margin-top: 0; /* Adjusted for no logo header */
            top: 0; /* Adjusted for no logo header */
          }
          .stats-grid {
            grid-template-columns: 1fr 1fr;
            gap: 8px;
          }
          .stat-card {
            padding: 10px;
          }
          .stat-number {
            font-size: 18px;
          }
          .main-content {
            padding: 10px;
          }
          .order-card {
            padding: 12px;
          }
          .items-container {
            padding: 10px;
          }
          .item-row {
            padding: 8px 0;
          }
          .action-btn,
          .ready-status {
            padding: 10px 12px;
          }
        }
        /* Animation for ready orders */
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.02);
          }
          100% {
            transform: scale(1);
          }
        }
        .order-card[style*="border-color: #28a745"] {
          animation: pulse 2s infinite;
        }
      `}</style>
        </div>
    )
}
