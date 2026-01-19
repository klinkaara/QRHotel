"use client"
import { useEffect, useState, useRef, useMemo } from "react"

import { db } from "../firebase"
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  where,
  getDocs,
  setDoc,
  deleteDoc,
  Timestamp,
  addDoc,
  writeBatch,
} from "firebase/firestore"

import menuItems from "../data/menuData"
import LoadingSpinner from "../data/loading-spinner"

export default function WaiterDashboard() {
  const [mergedOrders, setMergedOrders] = useState([])
  const [tablePins, setTablePins] = useState([])
  const [individualOrders, setIndividualOrders] = useState([])
  const [kitchenStatuses, setKitchenStatuses] = useState({})
  const [individualItems, setIndividualItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState("connected")
  const [newOrderAlert, setNewOrderAlert] = useState(null)
  // Refs for tracking previous states to detect new orders
  const prevIndividualOrdersRef = useRef([])
  const prevIndividualItemsRef = useRef([])
  const audioRef = useRef(null)

  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  const headerRef = useRef(null)

  // Generate table numbers 1 to 12
  const numericTables = Array.from({ length: 12 }, (_, i) => (i + 1).toString())
  // Generate table numbers B1 to B9
  const alphanumericTables = Array.from({ length: 9 }, (_, i) => `B${i + 1}`)
  // Combine both sets of table numbers
  const tableNumbers = [...numericTables, ...alphanumericTables]

  // Initialize audio for notifications
  useEffect(() => {
    audioRef.current = new Audio(
      "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OSnTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT",
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

  // Helper function for status colors
  const getStatusColor = (status) => {
    switch (status) {
      case "Waiting":
      case "Pending":
        return "#ffc107"
      case "Preparing":
      case "SentToKitchen":
        return "#17a2b8"
      case "Ready":
        return "#28a745"
      case "Canceled":
        return "#dc3545"
      case "InfoSubmitted":
        return "#007bff"
      case "ClosingRequested":
        return "#ff8c00"
      default:
        return "#6c757d"
    }
  }
  // Helper function for status text
  const getStatusText = (status) => {
    switch (status) {
      case "Waiting":
        return "⏳ Waiting"
      case "Pending":
        return "📝 Order Placed"
      case "Preparing":
        return "👨‍🍳 Being Prepared"
      case "Ready":
        return "✅ Ready to Serve"
      case "SentToKitchen":
        return "🍳 Sent to Kitchen"
      case "Edited":
        return "✏️ Order Updated"
      case "Canceled":
        return "❌ Canceled"
      case "InfoSubmitted":
        return "👤 Info Submitted"
      case "ClosingRequested":
        return "🛎️ Close Requested"
      default:
        return "Status Unknown"
    }
  }
  // Function to show new order notification
  const showNewOrderNotification = (orderData) => {
    setNewOrderAlert({
      message: `🔔 New order from Table ${orderData.table}!`,
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
  // Enhanced listener for table pins with connection status
  useEffect(() => {
    setConnectionStatus("connecting")
    const unsubscribe = onSnapshot(
      collection(db, "tablePins"),
      (snapshot) => {
        const pins = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setTablePins(pins)
        setConnectionStatus("connected")
      },
      (error) => {
        console.error("Error listening to table pins:", error)
        setConnectionStatus("error")
      },
    )
    return () => unsubscribe()
  }, [])
  // Enhanced listener for merged orders
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "mergedOrders"),
      (snapshot) => {
        const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setMergedOrders(orders)
      },
      (error) => {
        console.error("Error listening to merged orders:", error)
        setConnectionStatus("error")
      },
    )
    return () => unsubscribe()
  }, [])
  // Enhanced listener for individual orders with new order detection
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        collection(db, "orders"),
        where("sessionActive", "==", true),
        where("status", "in", ["InfoSubmitted", "Pending"]),
      ),
      (snapshot) => {
        const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        // Check for new orders
        const prevOrders = prevIndividualOrdersRef.current
        const newOrders = orders.filter((order) => !prevOrders.find((prevOrder) => prevOrder.id === order.id))
        if (newOrders.length > 0 && prevOrders.length > 0) {
          newOrders.forEach((order) => {
            showNewOrderNotification(order)
          })
        }
        setIndividualOrders(orders)
        prevIndividualOrdersRef.current = orders
      },
      (error) => {
        console.error("Error listening to individual orders:", error)
        setConnectionStatus("error")
      },
    )
    return () => unsubscribe()
  }, [])
  // Enhanced listener for kitchen statuses
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "mergedOrders"),
      (snapshot) => {
        const statuses = {}
        snapshot.docs.forEach((doc) => {
          const data = doc.data()
          if (data.kitchenStatus) {
            statuses[data.table] = {
              status: data.kitchenStatus,
              updatedAt: data.kitchenUpdatedAt,
            }
          }
        })
        setKitchenStatuses(statuses)
      },
      (error) => {
        console.error("Error listening to kitchen statuses:", error)
        setConnectionStatus("error")
      },
    )
    return () => unsubscribe()
  }, [])
  // Enhanced listener for individual items with new item detection
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "individualItems"),
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        // Check for new items
        const prevItems = prevIndividualItemsRef.current
        const newItems = items.filter(
          (item) => !prevItems.find((prevItem) => prevItem.id === item.id) && item.kitchenStatus !== "Canceled",
        )
        if (newItems.length > 0 && prevItems.length > 0) {
          // Group new items by table for notification
          const itemsByTable = {}
          newItems.forEach((item) => {
            if (!itemsByTable[item.table]) {
              itemsByTable[item.table] = []
            }
            itemsByTable[item.table].push(item.itemName)
          })
          Object.entries(itemsByTable).forEach(([table, itemNames]) => {
            showNewOrderNotification({
              table,
              items: itemNames,
            })
          })
        }
        setIndividualItems(items)
        prevIndividualItemsRef.current = items
      },
      (error) => {
        console.error("Error listening to individual items:", error)
        setConnectionStatus("error")
      },
    )
    return () => unsubscribe()
  }, [])
  const activateTable = async (table) => {
    setLoading(true)
    try {
      const existing = tablePins.find((p) => p.table === table && !p.closed)
      if (existing) {
        alert(`Table ${table} is already active with PIN: ${existing.pin}`)
        return
      }
      const pin = Math.floor(1000 + Math.random() * 9000).toString()
      const sessionId = `table${table}_${Date.now()}`
      await setDoc(doc(db, "tablePins", String(table)), {
        table,
        pin,
        sessionId,
        created: Timestamp.now(),
        closed: false,
        closingRequested: false,
      })
      await setDoc(doc(db, "mergedOrders", sessionId), {
        sessionId,
        table,
        items: [],
        status: "Active",
        kitchenStatus: "Waiting",
        updated: Timestamp.now(),
      })
    } catch (error) {
      console.error("Failed to activate table:", error)
      alert("❌ Failed to activate table")
    } finally {
      setLoading(false)
    }
  }
  const closeTable = async (table) => {
    const tablePin = tablePins.find((p) => p.table === table && !p.closed)
    if (!tablePin) {
      alert("Table is not active")
      return
    }

    setLoading(true)

    try {
      // 1️⃣ Close table pin
      await updateDoc(doc(db, "tablePins", String(table)), {
        closed: true,
        closedAt: Timestamp.now(),
        closingRequested: false,
      })

      // 2️⃣ Fetch all related data FIRST
      const ordersSnap = await getDocs(
        query(collection(db, "orders"), where("sessionId", "==", tablePin.sessionId))
      )

      const individualItemsSnap = await getDocs(
        query(collection(db, "individualItems"), where("sessionId", "==", tablePin.sessionId))
      )

      const kitchenOrdersSnap = await getDocs(
        query(collection(db, "kitchenOrders"), where("table", "==", table))
      )

      // 3️⃣ Batch everything
      const batch = writeBatch(db)

      ordersSnap.docs.forEach((orderDoc) => {
        batch.update(doc(db, "orders", orderDoc.id), {
          status: "Completed",
          sessionActive: false,
          closedAt: Timestamp.now(),
        })
      })

      individualItemsSnap.docs.forEach((itemDoc) => {
        batch.delete(doc(db, "individualItems", itemDoc.id))
      })

      kitchenOrdersSnap.docs.forEach((kitchenDoc) => {
        batch.delete(doc(db, "kitchenOrders", kitchenDoc.id))
      })

      // 4️⃣ Remove merged order
      const mergedOrder = mergedOrders.find((o) => o.table === table)
      if (mergedOrder) {
        batch.delete(doc(db, "mergedOrders", mergedOrder.id))
      }

      await batch.commit()
    } catch (error) {
      console.error("Failed to close table:", error)
      alert("❌ Failed to close table")
    } finally {
      setLoading(false)
    }
  }

  const clearAllTables = async () => {
    if (!window.confirm("Are you sure you want to clear all tables? This will close all active sessions.")) {
      return
    }

    setLoading(true)

    try {
      // 1️⃣ Fetch everything FIRST
      const pinsSnap = await getDocs(collection(db, "tablePins"))
      const mergedSnap = await getDocs(collection(db, "mergedOrders"))
      const individualItemsSnap = await getDocs(collection(db, "individualItems"))
      const ordersSnap = await getDocs(collection(db, "orders"))
      const kitchenOrdersSnap = await getDocs(collection(db, "kitchenOrders"))

      // 2️⃣ Batch all operations
      const batch = writeBatch(db)

      pinsSnap.docs.forEach((docSnap) => {
        batch.delete(doc(db, "tablePins", docSnap.id))
      })

      mergedSnap.docs.forEach((docSnap) => {
        batch.delete(doc(db, "mergedOrders", docSnap.id))
      })

      individualItemsSnap.docs.forEach((docSnap) => {
        batch.delete(doc(db, "individualItems", docSnap.id))
      })

      kitchenOrdersSnap.docs.forEach((docSnap) => {
        batch.delete(doc(db, "kitchenOrders", docSnap.id))
      })

      ordersSnap.docs.forEach((docSnap) => {
        batch.update(doc(db, "orders", docSnap.id), {
          status: "Completed",
          sessionActive: false,
          closedAt: Timestamp.now(),
        })
      })

      // 3️⃣ Commit ONCE
      await batch.commit()
    } catch (error) {
      console.error("Failed to clear tables:", error)
      alert("❌ Failed to clear tables")
    } finally {
      // 4️⃣ GUARANTEED spinner stop
      setLoading(false)
    }
  }

  const adjustIndividualItemQuantity = async (itemGroup, delta) => {
    setLoading(true)
    const { itemName, sessionId, ids, table } = itemGroup
    const itemPrice = menuItems.find((item) => item.name === itemName)?.price || 0
    try {
      if (delta > 0) {
        const numToAdd = delta
        for (let i = 0; i < numToAdd; i++) {
          await addDoc(collection(db, "individualItems"), {
            table,
            sessionId,
            itemName,
            price: itemPrice,
            customerName: "Waiter Adjustment",
            customerPhone: "",
            status: "Pending",
            kitchenStatus: "Waiting",
            created: Timestamp.now(),
            itemId: `${itemName}_Waiter_${Date.now()}_${Math.random()}`,
          })
        }
      } else if (delta < 0) {
        const numToRemove = Math.abs(delta)
        const itemsToCancel = ids
          .filter((id) => {
            const item = individualItems.find((i) => i.id === id)
            return item && item.kitchenStatus !== "Canceled" && item.status !== "Canceled"
          })
          .slice(0, numToRemove)
        const batch = writeBatch(db)

        itemsToCancel.forEach((itemId) => {
          batch.update(doc(db, "individualItems", itemId), {
            kitchenStatus: "Canceled",
            status: "Canceled",
            updated: Timestamp.now(),
          })
        })

        await batch.commit()

      }
      await syncMergedOrderWithIndividualItems(sessionId, table)
    } catch (error) {
      console.error("Failed to adjust quantity:", error)
      alert("❌ Failed to adjust quantity")
    } finally {
      setLoading(false)
    }
  }
  const sendItemTypeToKitchen = async (itemGroup) => {
    setLoading(true)
    const { itemName, sessionId, table } = itemGroup
    const itemPrice = menuItems.find((item) => item.name === itemName)?.price || 0
    try {
      const itemsToSend = individualItems.filter(
        (item) =>
          item.sessionId === sessionId &&
          item.itemName === itemName &&
          item.kitchenStatus !== "SentToKitchen" &&
          item.kitchenStatus !== "Pending" &&
          item.kitchenStatus !== "Preparing" &&
          item.kitchenStatus !== "Ready" &&
          item.kitchenStatus !== "Canceled",
      )
      if (itemsToSend.length === 0) {
        alert(`No new ${itemName} items to send to kitchen for Table ${table}.`)
        return
      }
      const batch = writeBatch(db)

      itemsToSend.forEach((item) => {
        batch.update(doc(db, "individualItems", item.id), {
          kitchenStatus: "Pending",
          updated: Timestamp.now(),
        })
      })

      await batch.commit()

      const existingKitchenOrderQuery = query(
        collection(db, "kitchenOrders"),
        where("table", "==", table),
        where("originalOrderId", "==", sessionId),
        where("items", "array-contains", { name: itemName, qty: itemsToSend.length, price: itemPrice }),
      )
      const existingKitchenOrderSnap = await getDocs(existingKitchenOrderQuery)
      let kitchenOrderId
      let currentKitchenItems = []
      if (!existingKitchenOrderSnap.empty) {
        const existingDoc = existingKitchenOrderSnap.docs[0]
        kitchenOrderId = existingDoc.id
        currentKitchenItems = existingDoc.data().items || []
        const itemIndex = currentKitchenItems.findIndex((i) => i.name === itemName)
        if (itemIndex > -1) {
          currentKitchenItems[itemIndex].qty += itemsToSend.length
        } else {
          currentKitchenItems.push({ name: itemName, qty: itemsToSend.length, price: itemPrice })
        }
        await updateDoc(doc(db, "kitchenOrders", kitchenOrderId), {
          items: currentKitchenItems,
          status: "Pending",
          receivedAt: Timestamp.now(),
          total: getTotal(currentKitchenItems),
        })
      } else {
        kitchenOrderId = `kitchen_${sessionId}_${itemName}_${Date.now()}`
        currentKitchenItems = [{ name: itemName, qty: itemsToSend.length, price: itemPrice }]
        const kitchenOrderData = {
          originalOrderId: sessionId,
          table: table,
          customerNames: getCustomerNamesForTable(table),
          items: currentKitchenItems,
          status: "Pending",
          orderNumber: Date.now(),
          receivedAt: Timestamp.now(),
          total: getTotal(currentKitchenItems),
        }
        await setDoc(doc(db, "kitchenOrders", kitchenOrderId), kitchenOrderData)
      }
      await updateDoc(doc(db, "mergedOrders", sessionId), {
        status: "SentToKitchen",
        kitchenStatus: "Pending",
        sentToKitchenAt: Timestamp.now(),
        updated: Timestamp.now(),
      })
    } catch (error) {
      console.error("Failed to send item to kitchen:", error)
      alert("❌ Failed to send item to kitchen")
    } finally {
      setLoading(false)
    }
  }
  const updateIndividualItemStatus = async (itemIds, newStatus, sessionId, table) => {
    setLoading(true)
    try {
      const batch = writeBatch(db)

      itemIds.forEach((id) => {
        batch.update(doc(db, "individualItems", id), {
          kitchenStatus: newStatus,
          updated: Timestamp.now(),
        })
      })

      await batch.commit()
      await syncMergedOrderWithIndividualItems(sessionId, table)
    } catch (error) {
      console.error("Failed to update individual item status:", error)
      alert("❌ Failed to update item status")
    } finally {
      setTimeout(() => setLoading(false), 300)
    }
  }

  const syncMergedOrderWithIndividualItems = async (sessionId, table) => {
    const activeIndividualItems = individualItems.filter(
      (item) => item.sessionId === sessionId && item.kitchenStatus !== "Canceled" && item.status !== "Canceled",
    )
    const combinedItems = {}
    activeIndividualItems.forEach((item) => {
      if (combinedItems[item.itemName]) {
        combinedItems[item.itemName].qty += 1
      } else {
        combinedItems[item.itemName] = {
          name: item.itemName,
          price: item.price,
          qty: 1,
        }
      }
    })
    await setDoc(
      doc(db, "mergedOrders", sessionId),
      {
        sessionId,
        table,
        items: Object.values(combinedItems),
        updated: Timestamp.now(),
        status: Object.values(combinedItems).length > 0 ? "Pending" : "NoItems",
        kitchenStatus: "Waiting",
      },
      { merge: true },
    )
  }
  const getPinForTable = (table) => {
    const found = tablePins.find((p) => p.table === table && !p.closed)
    return found ? found.pin : null
  }
  const getTotal = (items) => {
    if (!items || !Array.isArray(items)) return 0
    return items.reduce((total, item) => total + item.qty * item.price, 0)
  }
  const isTableActive = (table) => {
    return tablePins.some((p) => p.table === table && !p.closed)
  }
  const getOrderForTable = (table) => {
    return mergedOrders.find((order) => order.table === table)
  }
  const getCustomerNamesForTable = (table) => {
    const tableOrders = individualOrders.filter((order) => order.table === table && order.sessionActive === true)
    const uniqueNames = [...new Set(tableOrders.map((order) => order.customerName).filter(Boolean))]
    return uniqueNames
  }
  const getCustomerInfoForTable = (table) => {
    const tableOrders = individualOrders.filter((order) => order.table === table && order.sessionActive === true)
    const customers = tableOrders
      .map((order) => ({
        name: order.customerName,
        phone: order.customerPhone,
        status: order.status,
      }))
      .filter((customer) => customer.name)
    const uniqueCustomers = customers.filter(
      (customer, index, self) => index === self.findIndex((c) => c.phone === customer.phone),
    )
    return uniqueCustomers
  }
  const getGroupedIndividualItemsForTable = (table) => {
    const tablePinData = tablePins.find((p) => p.table === table && !p.closed)
    if (!tablePinData) return { groupedItems: [], totalBill: 0 }
    const tableItems = individualItems.filter((item) => item.sessionId === tablePinData.sessionId)
    let totalBill = 0
    const grouped = tableItems.reduce((acc, item) => {
      const key = item.itemName
      if (!acc[key]) {
        acc[key] = {
          itemName: item.itemName,
          price: item.price,
          table: item.table,
          sessionId: item.sessionId,
          customerOrderedQty: 0,
          currentQty: 0,
          pendingKitchenQty: 0,
          readyQty: 0,
          canceledQty: 0,
          ids: [],
          pendingKitchenIds: [],
          readyIds: [],
          canceledIds: [],
          customers: [],
        }
      }
      acc[key].customerOrderedQty += 1
      acc[key].ids.push(item.id)
      if (item.kitchenStatus === "Canceled" || item.status === "Canceled") {
        acc[key].canceledQty += 1
        acc[key].canceledIds.push(item.id)
      } else {
        acc[key].currentQty += 1
        totalBill += item.price
        if (item.kitchenStatus === "Ready") {
          acc[key].readyQty += 1
          acc[key].readyIds.push(item.id)
        } else if (["Pending", "Preparing", "SentToKitchen"].includes(item.kitchenStatus)) {
          acc[key].pendingKitchenQty += 1
          acc[key].pendingKitchenIds.push(item.id)
        }
      }
      if (item.customerName && !acc[key].customers.includes(item.customerName)) {
        acc[key].customers.push(item.customerName)
      }
      return acc
    }, {})
    return { groupedItems: Object.values(grouped), totalBill }
  }
  const activeTables = useMemo(
    () => tablePins.filter((p) => !p.closed).length,
    [tablePins]
  )

  const totalBill = tablePins
    .filter((p) => !p.closed)
    .reduce((total, pin) => {
      const { totalBill } = getGroupedIndividualItemsForTable(pin.table)
      return total + totalBill
    }, 0)
  return (
    <div className="dashboard-container">
      {loading && <LoadingSpinner />}
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
        ref={headerRef}
        className="header"
        style={{
          transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
          transition: "transform 0.3s ease-in-out",
        }}
      >
        <div className="header-content">
          {/* Top Row */}
          <div className="header-top">
            <div className="header-title">
              <h1>
                <img
                  src="/logo.png"
                  width="150"
                  height="150"
                  alt="Restaurant logo"
                  style={{ verticalAlign: "middle", marginRight: "10px" }}
                />
                🧑‍🍳 Waiter Dashboard
              </h1>
              <p>Restaurant Management System - Live Updates</p>
            </div>
            <button onClick={clearAllTables} className="clear-all-btn">
              🗑️ Clear All Tables
            </button>
          </div>
          {/* Stats Row */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-number">{activeTables}</div>
              <div className="stat-label">Active Tables</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">₹{totalBill}</div>
              <div className="stat-label">Total Revenue</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">
                {Object.values(kitchenStatuses).filter((s) => s.status === "Ready").length}
              </div>
              <div className="stat-label">Ready Orders</div>
            </div>
            <div className="stat-card">
              <div className="stat-number">
                {Object.values(kitchenStatuses).filter((s) => ["Preparing", "Pending"].includes(s.status)).length}
              </div>
              <div className="stat-label">In Kitchen</div>
            </div>
          </div>
        </div>
      </div>
      <div className="main-content">
        {/* Table PINs Section */}
        <div className="section">
          <h3 className="section-title">📌 Table PINs</h3>
          <div className="table-pins-grid">
            {tableNumbers.map((table) => {
              const pin = getPinForTable(table)
              const active = isTableActive(table)
              const tablePinDoc = tablePins.find((p) => p.table === table && !p.closed)
              const closingRequested = tablePinDoc?.closingRequested || false
              const currentTableKitchenStatus = kitchenStatuses[table]?.status
              let pinBorderColor = active ? "#28a745" : "#6c757d"
              let pinBackgroundColor = active ? "#d4edda" : "#f8f9fa"
              if (closingRequested) {
                pinBorderColor = "#ff8c00"
                pinBackgroundColor = "#ffe0b2"
              } else if (currentTableKitchenStatus === "Ready") {
                pinBorderColor = "#28a745"
                pinBackgroundColor = "#e6ffe6"
              } else if (["Preparing", "SentToKitchen", "Pending"].includes(currentTableKitchenStatus)) {
                pinBorderColor = "#17a2b8"
                pinBackgroundColor = "#e0f7fa"
              }
              return (
                <div
                  key={table}
                  className={`table-pin-card ${closingRequested ? "blink-animation" : ""}`}
                  style={{
                    borderColor: pinBorderColor,
                    backgroundColor: pinBackgroundColor,
                  }}
                >
                  {closingRequested && <div className="closing-indicator">🛎️</div>}
                  <h4 className="table-number">Table {table}</h4>
                  {active ? (
                    <>
                      <div className="pin-display">PIN: {pin}</div>
                      <button onClick={() => closeTable(table)} className="close-table-btn">
                        ❌ Close Table
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="inactive-label">Inactive</div>
                      <button onClick={() => activateTable(table)} className="activate-table-btn">
                        ✅ Activate Table
                      </button>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        {/* Orders Section */}
        <div className="section">
          <h3 className="section-title">📋 Table Orders</h3>
          <div className="orders-grid">
            {tableNumbers.map((table) => {
              const order = getOrderForTable(table)
              const active = isTableActive(table)
              const customerInfo = getCustomerInfoForTable(table)
              const { groupedItems: individualTableItems, totalBill: totalBillForTable } =
                getGroupedIndividualItemsForTable(table)
              if (!active) return null
              const currentTableKitchenStatus = kitchenStatuses[table]?.status
              let tableCardBgColor = "white"
              let tableCardBorderColor = "#ddd"
              if (currentTableKitchenStatus === "Ready") {
                tableCardBgColor = "#e6ffe6"
                tableCardBorderColor = "#28a745"
              } else if (
                currentTableKitchenStatus === "Preparing" ||
                currentTableKitchenStatus === "SentToKitchen" ||
                currentTableKitchenStatus === "Pending"
              ) {
                tableCardBgColor = "#e0f7fa"
                tableCardBorderColor = "#17a2b8"
              }
              return (
                <div
                  key={table}
                  className={`order-card ${currentTableKitchenStatus === "Ready" ? "blink-animation" : ""}`}
                  style={{
                    borderColor: tableCardBorderColor,
                    backgroundColor: tableCardBgColor,
                  }}
                >
                  <div className="order-header">
                    <div className="order-info">
                      <h4 className="order-table-title">Table {table}</h4>
                      {customerInfo.length > 0 && (
                        <div className="customer-info">
                          <strong>Current Customers:</strong>
                          <div className="customer-list">
                            {customerInfo.map((customer, idx) => (
                              <div key={idx} className="customer-item">
                                👤 <strong>{customer.name}</strong>
                                {customer.phone && <div className="customer-phone">📱 {customer.phone}</div>}
                                <span
                                  className="customer-status"
                                  style={{
                                    backgroundColor: getStatusColor(customer.status),
                                    color: customer.status === "InfoSubmitted" ? "#000" : "white",
                                  }}
                                >
                                  {getStatusText(customer.status)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="order-status">
                      <span
                        className="status-badge"
                        style={{
                          backgroundColor: order && order.items && order.items.length > 0 ? "#28a745" : "#ffc107",
                          color: order && order.items && order.items.length > 0 ? "white" : "#000",
                        }}
                      >
                        {order && order.items && order.items.length > 0 ? "Has Orders" : "Active"}
                      </span>
                      {order && order.status === "SentToKitchen" && (
                        <>
                          <span className="status-badge kitchen-badge">In Kitchen</span>
                          {kitchenStatuses[table] && (
                            <span
                              className="status-badge"
                              style={{
                                backgroundColor: getStatusColor(kitchenStatuses[table].status),
                                color: kitchenStatuses[table].status === "Preparing" ? "#000" : "white",
                              }}
                            >
                              🍳 {getStatusText(kitchenStatuses[table].status)}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {/* Individual Items Management */}
                  {individualTableItems.length > 0 ? (
                    <div className="items-section">
                      <h5 className="items-title">🔍 Item Details & Actions:</h5>
                      <div className="items-container">
                        {individualTableItems.map((group, idx) => (
                          <div key={idx} className="item-group">
                            <div className="item-details">
                              <div className="item-info">
                                <div className="item-name">{group.itemName}</div>
                                <div className="item-stats">
                                  Ordered: {group.customerOrderedQty} • Confirmed: {group.currentQty}
                                </div>
                                <div className="item-customers">By: {[...new Set(group.customers)].join(", ")}</div>
                                <div
                                  className="item-status"
                                  style={{
                                    backgroundColor: getStatusColor(
                                      group.readyQty > 0
                                        ? "Ready"
                                        : group.pendingKitchenQty > 0
                                          ? "Preparing"
                                          : group.canceledQty === group.customerOrderedQty
                                            ? "Canceled"
                                            : "Waiting",
                                    ),
                                    color: group.readyQty > 0 || group.pendingKitchenQty > 0 ? "white" : "#000",
                                  }}
                                >
                                  {getStatusText(
                                    group.readyQty > 0
                                      ? "Ready"
                                      : group.pendingKitchenQty > 0
                                        ? "Preparing"
                                        : group.canceledQty === group.customerOrderedQty
                                          ? "Canceled"
                                          : "Waiting",
                                  )}
                                </div>
                              </div>
                              <div className="item-actions">
                                {/* Quantity Adjuster */}
                                <div className="quantity-adjuster">
                                  <button
                                    onClick={() => adjustIndividualItemQuantity(group, -1)}
                                    disabled={group.currentQty <= 0}
                                    className="qty-btn minus"
                                    style={{
                                      backgroundColor: group.currentQty <= 0 ? "#ccc" : "#dc3545",
                                      cursor: group.currentQty <= 0 ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    -
                                  </button>
                                  <span className="qty-display">{group.currentQty}</span>
                                  <button
                                    onClick={() => adjustIndividualItemQuantity(group, 1)}
                                    className="qty-btn plus"
                                  >
                                    +
                                  </button>
                                </div>
                                {/* Send to Kitchen Button */}
                                <button
                                  onClick={() => sendItemTypeToKitchen(group)}
                                  disabled={group.currentQty === 0 || group.pendingKitchenQty === group.currentQty}
                                  className="kitchen-btn"
                                  style={{
                                    backgroundColor:
                                      group.currentQty === 0 || group.pendingKitchenQty === group.currentQty
                                        ? "#6c757d"
                                        : "#007bff",
                                    cursor:
                                      group.currentQty === 0 || group.pendingKitchenQty === group.currentQty
                                        ? "not-allowed"
                                        : "pointer",
                                  }}
                                >
                                  🍳 Send {group.currentQty - group.pendingKitchenQty} to Kitchen
                                </button>
                                {/* Status Dropdown */}
                                <select
                                  value={
                                    group.readyQty > 0 ? "Ready" : group.pendingKitchenQty > 0 ? "Preparing" : "Waiting"
                                  }
                                  onChange={(e) =>
                                    updateIndividualItemStatus(group.ids, e.target.value, group.sessionId, group.table)
                                  }
                                  className="status-select"
                                >
                                  <option value="Waiting">Waiting</option>
                                  <option value="Pending">Pending</option>
                                  <option value="Preparing">Preparing</option>
                                  <option value="Ready">Ready</option>
                                  <option value="Canceled">Canceled</option>
                                </select>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="empty-state">
                      {customerInfo.length > 0 ? (
                        <p>👥 Customers added, waiting for orders...</p>
                      ) : (
                        <p>⏳ Waiting for customers to join...</p>
                      )}
                    </div>
                  )}
                  {/* Current Bill */}
                  {totalBillForTable > 0 && <div className="bill-display">💰 Current Bill: ₹{totalBillForTable}</div>}
                  {/* Close Table Button */}
                  <div className="close-table-section">
                    <button onClick={() => closeTable(table)} className="close-order-btn">
                      ❌ Close Table
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
          {tablePins.filter((p) => !p.closed).length === 0 && (
            <div className="no-tables">
              <h4>🏪 No active tables</h4>
              <p>Activate tables above to start receiving orders</p>
            </div>
          )}
        </div>
      </div>
      <style jsx>{`
        .dashboard-container {
          min-height: 100vh;
          background-color: #f8f9fa;
        }
        /* Removed .logo-header entirely */
        .header {
          background-color: white;
          color: #333;
          padding: 20px;
          border-bottom: 1px solid #e9ecef;
          box-shadow: none; /* Removed box-shadow */
          /* position: sticky; REMOVED */
          /* top: 0; REMOVED */
          /* z-index: 1000; REMOVED */
          margin-top: 0; /* Adjusted for no logo header */
          /* Add transition for smooth hide/show effect */
          transition: transform 0.3s ease-in-out;
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
          color: #343a40;
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
          display: flex;
          overflow-x: auto;
          gap: 15px;
          margin-top: 10px;
          padding-bottom: 5px;
          scrollbar-width: none;
        }
        .stats-grid::-webkit-scrollbar {
          display: none;
        }
        .stat-card {
          background-color: #f8f9fa;
          min-width: 150px;
          flex: 0 0 auto;
          padding: 15px;
          border-radius: 10px;
          text-align: center;
          border: 1px solid rgba(0,0,0,0.05);
        }
        .stat-number {
          font-size: 24px;
          font-weight: bold;
        }
        .stat-label {
          font-size: 12px;
          opacity: 0.9;
        }
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
          background-color: #28a745;
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
        .main-content {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .section {
          margin-bottom: 40px;
        }
        .section-title {
          margin-bottom: 20px;
          color: #333;
          font-size: clamp(1.2rem, 3vw, 1.5rem);
          border-bottom: 3px solid #667eea;
          padding-bottom: 10px;
        }
        .table-pins-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
          margin-bottom: 20px;
        }
        .table-pin-card {
          border: 2px solid;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          position: relative;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          transition: all 0.3s ease;
        }
        .closing-indicator {
          position: absolute;
          top: -10px;
          right: -10px;
          background-color: #ff8c00;
          color: white;
          padding: 8px;
          border-radius: 50%;
          font-size: 16px;
          font-weight: bold;
          box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
          z-index: 1;
          animation: pulse 2s infinite;
        }
        .table-number {
          margin: 0 0 15px 0;
          font-size: clamp(1.1rem, 3vw, 1.3rem);
          color: #333;
        }
        .pin-display {
          font-size: clamp(1.2rem, 4vw, 1.8rem);
          font-weight: bold;
          color: #007bff;
          margin-bottom: 20px;
          padding: 15px;
          background-color: white;
          border-radius: 8px;
          border: 2px dashed #007bff;
          box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .inactive-label {
          font-size: 16px;
          margin-bottom: 20px;
          color: #6c757d;
          font-style: italic;
        }
        .close-table-btn,
        .activate-table-btn {
          width: 100%;
          padding: 12px;
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: bold;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .close-table-btn {
          background-color: #dc3545;
        }
        .close-table-btn:hover {
          background-color: #c82333;
        }
        .activate-table-btn {
          background-color: #28a745;
        }
        .activate-table-btn:hover {
          background-color: #218838;
        }
        .orders-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .order-card {
          border: 2px solid;
          border-radius: 12px;
          padding: 20px;
          box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          min-height: 200px;
          transition: all 0.3s ease;
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
        .order-table-title {
          margin: 0 0 8px 0;
          color: #007bff;
          font-size: clamp(1.1rem, 3vw, 1.3rem);
        }
        .customer-info {
          font-size: 14px;
          color: #6c757d;
        }
        .customer-list {
          margin-top: 8px;
        }
        .customer-item {
          margin-bottom: 6px;
          padding: 8px;
          background-color: rgba(255, 255, 255, 0.7);
          border-radius: 6px;
          font-size: 12px;
        }
        .customer-phone {
          margin-top: 2px;
        }
        .customer-status {
          font-size: 10px;
          margin-top: 4px;
          padding: 2px 8px;
          border-radius: 12px;
          display: inline-block;
        }
        .order-status {
          display: flex;
          gap: 8px;
          flex-direction: column;
          align-items: flex-end;
          min-width: 120px;
        }
        .status-badge {
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          text-align: center;
        }
        .kitchen-badge {
          background-color: #17a2b8;
          color: white;
        }
        .items-section {
          margin-bottom: 20px;
        }
        .items-title {
          margin-bottom: 15px;
          color: #333;
          font-size: 16px;
          border-bottom: 1px solid #eee;
          padding-bottom: 8px;
        }
        .items-container {
          max-height: 400px;
          overflow-y: auto;
          border: 1px solid #eee;
          border-radius: 8px;
          padding: 10px;
          background-color: rgba(255, 255, 255, 0.5);
        }
        .item-group {
          margin-bottom: 15px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 10px;
          background-color: #f9f9f9;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        .item-details {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          flex-wrap: wrap;
          gap: 10px;
        }
        .item-info {
          flex: 1;
          min-width: 150px;
        }
        .item-name {
          font-weight: bold;
          font-size: 16px;
          margin-bottom: 8px;
        }
        .item-stats,
        .item-customers {
          font-size: 12px;
          color: #666;
          margin-bottom: 4px;
        }
        .item-customers {
          margin-bottom: 8px;
        }
        .item-status {
          font-size: 11px;
          padding: 4px 8px;
          border-radius: 12px;
          display: inline-block;
        }
        .item-actions {
          display: flex;
          flex-direction: column;
          gap: 8px;
          align-items: center;
          min-width: 120px;
        }
        .quantity-adjuster {
          display: flex;
          align-items: center;
          gap: 8px;
          background-color: white;
          padding: 8px;
          border-radius: 8px;
          border: 1px solid #ddd;
        }
        .qty-btn {
          width: 32px;
          height: 32px;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 16px;
          font-weight: bold;
        }
        .qty-btn.minus {
          background-color: #dc3545;
        }
        .qty-btn.plus {
          background-color: #28a745;
        }
        .qty-display {
          font-weight: bold;
          font-size: 18px;
          min-width: 30px;
          text-align: center;
        }
        .kitchen-btn {
          padding: 8px 12px;
          color: white;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 12px;
          font-weight: bold;
          text-align: center;
          min-width: 100px;
        }
        .status-select {
          padding: 6px 8px;
          border: 1px solid #ccc;
          border-radius: 6px;
          background-color: white;
          cursor: pointer;
          font-size: 11px;
          min-width: 100px;
        }
        .empty-state {
          text-align: center;
          padding: 40px 20px;
          color: #6c757d;
          font-style: italic;
          background-color: rgba(255, 255, 255, 0.5);
          border-radius: 8px;
          border: 2px dashed #ddd;
        }
        .empty-state p {
          margin: 0;
          font-size: 16px;
        }
        .bill-display {
          font-size: clamp(1.2rem, 4vw, 1.5rem);
          font-weight: bold;
          text-align: center;
          margin-top: 20px;
          padding: 20px;
          border-top: 3px solid #007bff;
          background-color: rgba(255, 255, 255, 0.8);
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .close-table-section {
          text-align: center;
          margin-top: 20px;
        }
        .close-order-btn {
          padding: 12px 24px;
          background-color: #dc3545;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        .close-order-btn:hover {
          background-color: #c82333;
        }
        .no-tables {
          text-align: center;
          padding: 60px 20px;
          background-color: white;
          border-radius: 12px;
          color: #6c757d;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          border: 2px dashed #ddd;
        }
        .no-tables h4 {
          margin: 0 0 15px 0;
          font-size: clamp(1.2rem, 3vw, 1.5rem);
        }
        .no-tables p {
          margin: 0;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
        }
        .blink-animation {
          animation: blink 2s infinite;
        }
        @keyframes blink {
          0%,
          50% {
            opacity: 1;
          }
          51%,
          100% {
            opacity: 0.7;
          }
        }
        @keyframes pulse {
          0% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
          100% {
            transform: scale(1);
          }
        }
        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
          /* Removed .logo-header related styles */
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
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .main-content {
            padding: 15px;
          }
          /* Mobile: 3 table pins per row */
          .table-pins-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }
          .table-pin-card {
            padding: 12px;
          }
          .table-number {
            font-size: 14px;
            margin-bottom: 10px;
          }
          .pin-display {
            font-size: 16px;
            padding: 10px;
            margin-bottom: 12px;
          }
          .inactive-label {
            font-size: 12px;
            margin-bottom: 10px;
          }
          .close-table-btn,
          .activate-table-btn {
            padding: 8px;
            font-size: 12px;
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
            min-width: unset;
          }
          .order-status {
            align-items: stretch;
            min-width: unset;
          }
          .item-details {
            flex-direction: column;
            gap: 15px;
          }
          .item-info {
            min-width: unset;
          }
          .item-actions {
            min-width: unset;
            align-items: stretch;
          }
          .quantity-adjuster {
            justify-content: center;
          }
          .kitchen-btn {
            min-width: unset;
          }
          .status-select {
            min-width: unset;
          }
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
        }
        @media (max-width: 480px) {
          .header {
            padding: 10px;
            margin-top: 0; /* Adjusted for no logo header */
            top: 0; /* Adjusted for no logo header */
          }
          .stats-grid {
            grid-template-columns: 1fr 1fr;
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
          .section-title {
            font-size: 18px;
          }
          /* Mobile: Still 3 columns but smaller */
          .table-pins-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
          }
          .table-pin-card {
            padding: 8px;
          }
          .table-number {
            font-size: 12px;
            margin-bottom: 8px;
          }
          .pin-display {
            font-size: 14px;
            padding: 8px;
            margin-bottom: 10px;
          }
          .inactive-label {
            font-size: 12px;
            margin-bottom: 10px;
          }
          .close-table-btn,
          .activate-table-btn {
            padding: 6px;
            font-size: 10px;
          }
          .order-card {
            padding: 15px;
          }
          .customer-item {
            padding: 6px;
            font-size: 11px;
          }
          .items-container {
            max-height: 300px;
          }
          .item-group {
            padding: 10px;
          }
          .qty-btn {
            width: 28px;
            height: 28px;
            font-size: 14px;
          }
          .qty-display {
            font-size: 16px;
          }
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
        }
      `}</style>
    </div>
  )
}
