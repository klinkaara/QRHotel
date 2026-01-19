"use client"
import { db } from "../firebase"
import { useEffect, useState, useRef, useMemo } from "react"
import menuDataDefaults from "../data/menuData" // Import defaults for initialization

import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  query,
  where,
  getDocs,
  getDoc, // Added getDoc
  setDoc,
  deleteDoc,
  Timestamp,
  addDoc,
  orderBy,
  runTransaction,
  writeBatch,
} from "firebase/firestore"

import menuItems from "../data/menuData"
import LoadingSpinner from "../data/loading-spinner"

export default function OwnerDashboard() {
  const getLocalDateString = (date = new Date()) => {
    return date.toLocaleDateString("en-CA") // YYYY-MM-DD (LOCAL)
  }
  const today = getLocalDateString()
  const [mergedOrders, setMergedOrders] = useState([])
  const [tablePins, setTablePins] = useState([])
  const [individualOrders, setIndividualOrders] = useState([]) // Customer's raw orders
  const [kitchenStatuses, setKitchenStatuses] = useState({})
  const [individualItems, setIndividualItems] = useState([]) // All individual items
  const [allOrdersHistory, setAllOrdersHistory] = useState([]) // For analytics/history
  const [allIndividualItemsHistory, setAllIndividualItemsHistory] = useState([]) // For analytics/history
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState("activeTables") // New state for tab navigation
  // State for the bill viewer modal
  const [showBillModal, setShowBillModal] = useState(false)
  const [currentBillData, setCurrentBillData] = useState(null)
  // New states for date-wise reports
  const [selectedDate, setSelectedDate] = useState(getLocalDateString())

  const [dateWiseData, setDateWiseData] = useState({})
  const [connectionStatus, setConnectionStatus] = useState("connected")
  const [newOrderAlert, setNewOrderAlert] = useState(null)

  // NEW: Menu Management State
  const [menuCategories, setMenuCategories] = useState([])
  const [isMenuInitialized, setIsMenuInitialized] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null) // ID of category being edited
  const [newCategoryName, setNewCategoryName] = useState("")
  const [newItem, setNewItem] = useState({ name: "", price: "" })
  const [activeCategoryForAdd, setActiveCategoryForAdd] = useState(null) // Category ID to add item to

  // NEW: State for enhanced menu UI
  const [expandedCategories, setExpandedCategories] = useState({}) // Obj to track expanded state per ID
  const [editingItem, setEditingItem] = useState(null) // { categoryId, itemIndex, ...data }
  const [editingCategoryData, setEditingCategoryData] = useState(null) // { id, name }
  // Refs for tracking previous states to detect new orders
  const prevIndividualOrdersRef = useRef([])
  const audioRef = useRef(null)

  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  // </CHANGE>

  const numericTables = Array.from({ length: 12 }, (_, i) => (i + 1).toString())
  const alphanumericTables = Array.from({ length: 9 }, (_, i) => `B${i + 1}`)
  const tableNumbers = [...numericTables, ...alphanumericTables]

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
      case "Completed":
        return "#6c757d" // Grey for completed
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
      case "Completed":
        return "✔️ Completed"
      default:
        return "Status Unknown"
    }
  }
  // Helper function to get date string from timestamp
  const getDateString = (timestamp) => {
    if (!timestamp) return null
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleDateString("en-CA") // YYYY-MM-DD LOCAL
  }

  // Listen to table pins
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "tablePins"), (snapshot) => {
      const pins = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setTablePins(pins)
    })
    return () => unsubscribe()
  }, [])
  // Listen to merged orders (for overall table status)
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "mergedOrders"), (snapshot) => {
      const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setMergedOrders(orders)
    })
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
  // Listen to kitchen statuses (overall for merged orders)
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "mergedOrders"), (snapshot) => {
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
    })
    return () => unsubscribe()
  }, [])
  // Listen to individual items (the source of truth for item status and billing)
  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(
        collection(db, "individualItems"),
        where("status", "!=", "Completed")
      ),
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setIndividualItems(items)
      }
    )
    return () => unsubscribe()
  }, [])

  // NEW: Listen to ALL orders for history and analytics
  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, "orders"), orderBy("created", "desc")), (snapshot) => {
      const orders = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setAllOrdersHistory(orders)
    })
    return () => unsubscribe()
  }, [])
  // NEW: Listen to ALL individual items for history and analytics
  useEffect(() => {
    const unsubscribe = onSnapshot(query(collection(db, "individualItems"), orderBy("created", "desc")), (snapshot) => {
      const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setAllIndividualItemsHistory(items)
      // Process date-wise data
      const dateWise = {}
      items.forEach((item) => {
        const dateStr = getDateString(item.created)
        if (dateStr) {
          if (!dateWise[dateStr]) {
            dateWise[dateStr] = {
              totalRevenue: 0,
              totalOrders: 0,
              completedOrders: 0,
              canceledItems: 0,
              items: [],
              bills: [],
            }
          }
          dateWise[dateStr].items.push(item)
          if (item.status === "Completed" && item.kitchenStatus !== "Canceled") {
            dateWise[dateStr].totalRevenue += item.price
            dateWise[dateStr].completedOrders += 1
          }
          if (item.kitchenStatus === "Canceled" || item.status === "Canceled") {
            dateWise[dateStr].canceledItems += 1
          }
        }
      })
      setDateWiseData(dateWise)
    })
    return () => unsubscribe()
  }, [])

  // NEW: Listen to menu categories
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "menu"), (snapshot) => {
      const categories = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      setMenuCategories(categories)
      setIsMenuInitialized(categories.length > 0)
    })
    return () => unsubscribe()
  }, [])

  // Initialize audio for notifications
  useEffect(() => {
    audioRef.current = new Audio(
      "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBC13yO/eizEIHWq+8+OWT",
    )
  }, [])
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

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY
      const headerHeight = document.querySelector(".header")?.offsetHeight || 0

      if (currentScrollY > lastScrollY.current && currentScrollY > headerHeight) {
        // Scrolling down past header height
        setHeaderVisible(false)
      } else if (currentScrollY < lastScrollY.current) {
        // Scrolling up
        setHeaderVisible(true)
      }
      lastScrollY.current = currentScrollY
    }

    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])
  // </CHANGE>

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
      await updateDoc(doc(db, "tablePins", String(table)), {
        closed: true,
        closedAt: Timestamp.now(),
        closingRequested: false,
      })
      const mergedOrder = mergedOrders.find((o) => o.table === table)
      if (mergedOrder) {
        await deleteDoc(doc(db, "mergedOrders", mergedOrder.id))
      }
      const ordersQuery = query(collection(db, "orders"), where("sessionId", "==", tablePin.sessionId))
      const ordersSnap = await getDocs(ordersQuery)
      for (const orderDoc of ordersSnap.docs) {
        await updateDoc(doc(db, "orders", orderDoc.id), {
          status: "Completed",
          sessionActive: false,
          closedAt: Timestamp.now(),
        })
      }
      const individualItemsQuery = query(
        collection(db, "individualItems"),
        where("sessionId", "==", tablePin.sessionId),
      )
      const individualItemsSnap = await getDocs(individualItemsQuery)
      for (const itemDoc of individualItemsSnap.docs) {
        // For owner, we don't delete individual items, just mark them as completed/closed
        await updateDoc(doc(db, "individualItems", itemDoc.id), {
          status: "Completed",
          kitchenStatus: itemDoc.data().kitchenStatus === "Canceled" ? "Canceled" : "Completed", // Keep canceled status if already canceled
          closedAt: Timestamp.now(),
        })
      }
      const kitchenOrdersQuery = query(collection(db, "kitchenOrders"), where("table", "==", table))
      const kitchenOrdersSnap = await getDocs(kitchenOrdersQuery)
      for (const kitchenDoc of kitchenOrdersSnap.docs) {
        await deleteDoc(doc(db, "kitchenOrders", kitchenDoc.id))
      }
    } catch (error) {
      console.error("Failed to close table:", error)
      alert("❌ Failed to close table")
    } finally {
      setLoading(false)
    }
  }
  const clearAllTables = async () => {
    if (!window.confirm("Are you sure you want to clear ALL active tables? This will close all active sessions.")) {
      return
    }
    setLoading(true)
    try {
      const pinsSnap = await getDocs(query(collection(db, "tablePins"), where("closed", "==", false)))
      for (const pinDoc of pinsSnap.docs) {
        await updateDoc(doc(db, "tablePins", pinDoc.id), {
          closed: true,
          closedAt: Timestamp.now(),
          closingRequested: false,
        })
      }
      const mergedSnap = await getDocs(collection(db, "mergedOrders"))
      for (const mergedDoc of mergedSnap.docs) {
        await deleteDoc(doc(db, "mergedOrders", mergedDoc.id))
      }
      const activeOrdersSnap = await getDocs(query(collection(db, "orders"), where("sessionActive", "==", true)))
      for (const orderDoc of activeOrdersSnap.docs) {
        await updateDoc(doc(db, "orders", orderDoc.id), {
          status: "Completed",
          sessionActive: false,
          closedAt: Timestamp.now(),
        })
      }
      const activeIndividualItemsSnap = await getDocs(
        query(collection(db, "individualItems"), where("status", "!=", "Completed")),
      )
      for (const itemDoc of activeIndividualItemsSnap.docs) {
        await updateDoc(doc(db, "individualItems", itemDoc.id), {
          status: "Completed",
          kitchenStatus: itemDoc.data().kitchenStatus === "Canceled" ? "Canceled" : "Completed",
          closedAt: Timestamp.now(),
        })
      }
      const kitchenOrdersSnap = await getDocs(collection(db, "kitchenOrders"))
      for (const kitchenDoc of kitchenOrdersSnap.docs) {
        await deleteDoc(doc(db, "kitchenOrders", kitchenDoc.id))
      }
      alert("✅ All active tables cleared successfully.")
    } catch (error) {
      console.error("Failed to clear tables:", error)
      alert("❌ Failed to clear tables")
    } finally {
      setLoading(false)
    }
  }
  // NEW: Clear previous day's data
  const clearPreviousDayData = async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayStr = yesterday.toISOString().split("T")[0]
    if (
      !window.confirm(`Are you sure you want to clear all data from ${yesterdayStr}? This action cannot be undone.`)
    ) {
      return
    }
    setLoading(true)
    try {
      // Get yesterday's start and end timestamps
      const yesterdayStart = new Date(yesterdayStr + "T00:00:00")
      const yesterdayEnd = new Date(yesterdayStr + "T23:59:59")
      // Clear individual items from yesterday
      const itemsQuery = query(
        collection(db, "individualItems"),
        where("created", ">=", Timestamp.fromDate(yesterdayStart)),
        where("created", "<=", Timestamp.fromDate(yesterdayEnd)),
      )
      const itemsSnap = await getDocs(itemsQuery)
      for (const itemDoc of itemsSnap.docs) {
        await deleteDoc(doc(db, "individualItems", itemDoc.id))
      }
      // Clear orders from yesterday
      const ordersQuery = query(
        collection(db, "orders"),
        where("created", ">=", Timestamp.fromDate(yesterdayStart)),
        where("created", "<=", Timestamp.fromDate(yesterdayEnd)),
      )
      const ordersSnap = await getDocs(ordersQuery)
      for (const orderDoc of ordersSnap.docs) {
        await deleteDoc(doc(db, "orders", orderDoc.id))
      }
      alert(`✅ Successfully cleared all data from ${yesterdayStr}`)
    } catch (error) {
      console.error("Failed to clear previous day data:", error)
      alert("❌ Failed to clear previous day data")
    } finally {
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
            customerName: "Owner Adjustment", // Mark as owner adjustment
            customerPhone: "",
            status: "Pending",
            kitchenStatus: "Waiting",
            created: Timestamp.now(),
            itemId: `${itemName}_Owner_${Date.now()}_${Math.random()}`,
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
            canceledBy: "Owner",
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
      for (const item of itemsToSend) {
        await updateDoc(doc(db, "individualItems", item.id), {
          kitchenStatus: "Pending",
          updated: Timestamp.now(),
        })
      }
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
    const foundPin = tablePins.find((p) => p.table === table && !p.closed)
    if (!foundPin) return { groupedItems: [], totalBill: 0, totalQuantity: 0 }
    const sessionId = foundPin.sessionId
    const tableItems = individualItems.filter((item) => item.sessionId === sessionId)
    let totalBill = 0
    let totalQuantity = 0
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
        totalQuantity += 1 // Increment total quantity for non-canceled items
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
    return { groupedItems: Object.values(grouped), totalBill, totalQuantity }
  }
  // Handle View Bill button click
  const handleViewBill = async (table) => {
    // Make function async
    setLoading(true) // Start loading
    try {
      const { groupedItems, totalBill, totalQuantity } = getGroupedIndividualItemsForTable(table)
      const customerInfo = getCustomerInfoForTable(table)
      const customerName = customerInfo.length > 0 ? customerInfo[0].name : "Guest"
      const now = new Date()
      const currentDate = now.toLocaleDateString("en-GB") // DD/MM/YY format
      const currentTime = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }) // HH:MM format
      // Generate dynamic bill number using a transaction
      const billRef = doc(db, "settings", "billCounter")
      let newBillNo
      await runTransaction(db, async (transaction) => {
        const billDoc = await transaction.get(billRef)
        let currentBillNumber = 0
        if (billDoc.exists()) {
          currentBillNumber = billDoc.data().lastBillNumber || 0
        }
        newBillNo = currentBillNumber + 1
        transaction.set(billRef, { lastBillNumber: newBillNo })
      })
      setCurrentBillData({
        table,
        customerName,
        currentDate,
        currentTime,
        billNo: newBillNo.toString(), // Use the dynamically generated bill number
        groupedItems: groupedItems.filter((item) => item.currentQty > 0), // Only show non-canceled items
        subTotal: totalBill,
        totalQuantity,
        grandTotal: totalBill,
      })
      setShowBillModal(true)
    } catch (error) {
      console.error("Error generating bill:", error)
      alert("❌ Failed to generate bill. Please try again.")
    } finally {
      setLoading(false) // End loading
    }
  }
  // Handle Print Bill from modal
  const handlePrintModalBill = () => {
    const printContent = document.getElementById("bill-modal-content").innerHTML
    const originalContent = document.body.innerHTML
    document.body.innerHTML = printContent
    window.print()
    document.body.innerHTML = originalContent
    // Optionally, you might want to close the modal after printing
    // setShowBillModal(false);
    // setCurrentBillData(null);
    window.location.reload() // Reload to restore original page content and state
  }
  // NEW: Today's Analytics Calculations (only today's data)
  const calculateRevenueFromOrders = (orders, dateStr) => {
    let revenue = 0

    orders.forEach(order => {
      const orderDate = getDateString(order.created)
      if (order.status === "Completed" && orderDate === dateStr) {
        order.items?.forEach(item => {
          revenue += item.price * item.qty
        })
      }
    })

    return revenue
  }

  const calculateTodayAnalytics = () => {
    const todayItems = allIndividualItemsHistory.filter((item) => {
      const itemDate = getDateString(item.created)
      return itemDate === today
    })
    const todayOrders = allOrdersHistory.filter((order) => {
      const orderDate = getDateString(order.created)
      return orderDate === today
    })
    let totalRevenue = 0
    const totalOrdersPlaced = todayOrders.length
    let totalCompletedOrders = 0
    let totalCanceledItems = 0
    const totalActiveTables = tablePins.filter((p) => !p.closed).length
    const itemSales = {}
    todayItems.forEach((item) => {
      if (item.status === "Completed" && item.kitchenStatus !== "Canceled") {
        totalRevenue += item.price
        itemSales[item.itemName] = (itemSales[item.itemName] || 0) + 1
      }
      if (item.kitchenStatus === "Canceled" || item.status === "Canceled") {
        totalCanceledItems += 1
      }
    })
    todayOrders.forEach((order) => {
      if (order.status === "Completed") {
        totalCompletedOrders += 1
      }
    })
    const sortedItemSales = Object.entries(itemSales).sort(([, a], [, b]) => b - a)
    return {
      totalRevenue,
      totalOrdersPlaced,
      totalCompletedOrders,
      totalCanceledItems,
      totalActiveTables,
      itemSales: sortedItemSales,
    }
  }

  // NEW: Calculate Previous Month Analytics
  const calculatePreviousMonthAnalytics = () => {
    const now = new Date()
    const firstDayPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastDayPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0)
    lastDayPrevMonth.setHours(23, 59, 59, 999)

    const prevMonthItems = allIndividualItemsHistory.filter((item) => {
      if (!item.created) return false
      const itemDate = item.created.toDate ? item.created.toDate() : new Date(item.created)
      return itemDate >= firstDayPrevMonth && itemDate <= lastDayPrevMonth
    })

    let revenue = 0
    const itemsCount = prevMonthItems.filter(i => i.status === "Completed" && i.kitchenStatus !== "Canceled").length

    prevMonthItems.forEach((item) => {
      if (item.status === "Completed" && item.kitchenStatus !== "Canceled") {
        revenue += item.price
      }
    })

    // Get month name
    const monthName = firstDayPrevMonth.toLocaleString('default', { month: 'long', year: 'numeric' })

    return {
      revenue,
      itemsCount,
      monthName
    }
  }

  // NEW: Get Previous Month Data
  const prevMonthAnalytics = calculatePreviousMonthAnalytics()
  // NEW: Get analytics for specific date
  const getDateAnalytics = (dateStr) => {
    if (dateWiseData[dateStr]) {
      const data = dateWiseData[dateStr]
      const itemSales = {}
      data.items.forEach((item) => {
        if (item.status === "Completed" && item.kitchenStatus !== "Canceled") {
          itemSales[item.itemName] = (itemSales[item.itemName] || 0) + 1
        }
      })
      const sortedItemSales = Object.entries(itemSales).sort(([, a], [, b]) => b - a)
      return {
        totalRevenue: data.totalRevenue,
        totalOrdersPlaced: data.items.length,
        totalCompletedOrders: data.completedOrders,
        totalCanceledItems: data.canceledItems,
        itemSales: sortedItemSales,
      }
    }
    return {
      totalRevenue: 0,
      totalOrdersPlaced: 0,
      totalCompletedOrders: 0,
      totalCanceledItems: 0,
      itemSales: [],
    }
  }
  const todayAnalytics = calculateTodayAnalytics()
  const selectedDateAnalytics = getDateAnalytics(selectedDate)
  // NEW: Format Timestamp for display
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "N/A"
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp)
    return date.toLocaleString()
  }
  // NEW: Get today's history items
  const getTodayHistoryItems = () => {
    const today = getLocalDateString()

    return allIndividualItemsHistory.filter((item) => {
      const itemDate = getDateString(item.created)
      return itemDate === today
    })
  }
  const activeTables = useMemo(
    () => tablePins.filter((p) => !p.closed).length,
    [tablePins]
  )
  const totalRevenue = calculateRevenueFromOrders(allOrdersHistory, today)
  const readyOrders = Object.values(kitchenStatuses).filter((s) => s.status === "Ready").length
  const pendingOrders = Object.values(kitchenStatuses).filter((s) => ["Preparing", "Pending"].includes(s.status)).length

  // NEW: Menu Management Functions
  const initializeMenuData = async () => {
    if (!window.confirm("Initialize menu from defaults? This will add categories to your database.")) return

    setLoading(true)
    try {
      console.log("Starting menu initialization...")
      let successCount = 0

      for (const categoryData of menuDataDefaults) {
        try {
          await addDoc(collection(db, "menu"), categoryData)
          successCount++
        } catch (innerError) {
          console.error("Error adding category:", categoryData.category, innerError)
        }
      }

      if (successCount > 0) {
        alert(`✅ Menu initialized! Added ${successCount} categories.`)
      } else {
        alert("⚠️ No categories were added. Check console for details.")
      }
    } catch (error) {
      console.error("Error initializing menu generic:", error)
      alert(`❌ Failed to initialize menu: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAddCategory = async () => {
    if (!newCategoryName.trim()) {
      alert("Category name cannot be empty.")
      return
    }
    setLoading(true)
    try {
      await addDoc(collection(db, "menu"), {
        category: newCategoryName.trim(),
        items: [],
      })
      setNewCategoryName("")
      alert("✅ Category added successfully!")
    } catch (error) {
      console.error("Error adding category:", error)
      alert(`❌ Failed to add category: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleAddItem = async (categoryId) => {
    if (!newItem.name.trim() || !newItem.price) {
      alert("Item name and price cannot be empty.")
      return
    }
    const price = parseFloat(newItem.price)
    if (isNaN(price) || price <= 0) {
      alert("Price must be a positive number.")
      return
    }
    setLoading(true)
    try {
      const categoryRef = doc(db, "menu", categoryId)
      const categoryDoc = await getDoc(categoryRef)
      const currentItems = categoryDoc.data().items || []
      await updateDoc(categoryRef, {
        items: [...currentItems, { name: newItem.name.trim(), price: price }],
      })
      setNewItem({ name: "", price: "" })
      setActiveCategoryForAdd(null)
      alert("✅ Item added successfully!")
    } catch (error) {
      console.error("Error adding item:", error)
      alert(`❌ Failed to add item: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteCategory = async (categoryId) => {
    if (!window.confirm("Are you sure you want to delete this category and all its items?")) {
      return
    }
    setLoading(true)
    try {
      await deleteDoc(doc(db, "menu", categoryId))
      alert("✅ Category deleted successfully!")
    } catch (error) {
      console.error("Error deleting category:", error)
      alert(`❌ Failed to delete category: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteItem = async (categoryId, itemIndex) => {
    if (!window.confirm("Are you sure you want to delete this item?")) {
      return
    }
    setLoading(true)
    try {
      const categoryRef = doc(db, "menu", categoryId)
      const categoryDoc = await getDoc(categoryRef)
      const currentItems = categoryDoc.data().items || []
      const updatedItems = currentItems.filter((_, idx) => idx !== itemIndex)
      await updateDoc(categoryRef, { items: updatedItems })
      alert("✅ Item deleted successfully!")
    } catch (error) {
      console.error("Error deleting item:", error)
      alert(`❌ Failed to delete item: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // NEW: Update Category Name
  const handleUpdateCategory = async () => {
    if (!editingCategoryData || !editingCategoryData.name.trim()) return
    setLoading(true)
    try {
      await updateDoc(doc(db, "menu", editingCategoryData.id), {
        category: editingCategoryData.name.trim()
      })
      setEditingCategoryData(null)
      alert("✅ Category updated!")
    } catch (error) {
      console.error("Error updating category:", error)
      alert(`❌ Failed to update category: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  // NEW: Update Item
  const handleUpdateItem = async () => {
    if (!editingItem || !editingItem.name.trim() || !editingItem.price) return
    setLoading(true)
    try {
      const categoryRef = doc(db, "menu", editingItem.categoryId)
      const categoryDoc = await getDoc(categoryRef)
      const currentItems = categoryDoc.data().items || []

      const updatedItems = [...currentItems]
      updatedItems[editingItem.itemIndex] = {
        name: editingItem.name.trim(),
        price: parseFloat(editingItem.price)
      }

      await updateDoc(categoryRef, { items: updatedItems })
      setEditingItem(null)
      alert("✅ Item updated!")
    } catch (error) {
      console.error("Error updating item:", error)
      alert(`❌ Failed to update item: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const toggleCategory = (id) => {
    setExpandedCategories(prev => ({
      ...prev,
      [id]: !prev[id]
    }))
  }

  return (
    <div className="owner-dashboard">
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
        className="header"
        style={{
          transform: `translateY(${headerVisible ? "0" : "-100%"})`,
          transition: "transform 0.3s ease-in-out"
        }}
      >
        {/* </CHANGE> */}
        <div className="header-content">
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
                {/* </CHANGE> */}
                Owner Dashboard
              </h1>
              <p>Complete Restaurant Management & Analytics - Live Updates</p>
            </div>
            <div className="header-actions">
              <button onClick={clearPreviousDayData} className="clear-data-btn">
                🗑️ Clear Yesterday's Data
              </button>
              <button onClick={clearAllTables} className="clear-all-btn">
                🗑️ Clear All Active Tables
              </button>
            </div>
          </div>
          {/* Stats Row - Today's Data */}
          <div className="stats-grid">
            <div className="stat-card revenue">
              <div className="stat-number">₹{totalRevenue}</div>
              <div className="stat-label">Today's Revenue</div>
            </div>
            <div className="stat-card active-tables">
              <div className="stat-number">{activeTables}</div>
              <div className="stat-label">Active Tables</div>
            </div>
            <div className="stat-card ready-orders">
              <div className="stat-number">{readyOrders}</div>
              <div className="stat-label">Ready Orders</div>
            </div>
            <div className="stat-card pending-orders">
              <div className="stat-number">{pendingOrders}</div>
              <div className="stat-label">In Kitchen</div>
            </div>
            <div className="stat-card completed-orders">
              <div className="stat-number">{todayAnalytics.totalCompletedOrders}</div>
              <div className="stat-label">Today's Completed</div>
            </div>
          </div>

          {/* NEW: Monthly Performance Stats */}
          <h3 style={{ marginLeft: "5px", marginTop: "20px", marginBottom: "10px", color: "#666" }}>📅 Monthly Performance</h3>
          <div className="stats-grid">
            <div className="stat-card" style={{ borderLeft: "4px solid #6f42c1" }}>
              <div className="stat-number">₹{prevMonthAnalytics.revenue}</div>
              <div className="stat-label">Previous Month Income ({prevMonthAnalytics.monthName})</div>
            </div>
            <div className="stat-card" style={{ borderLeft: "4px solid #6f42c1" }}>
              <div className="stat-number">{prevMonthAnalytics.itemsCount}</div>
              <div className="stat-label">Items Sold ({prevMonthAnalytics.monthName})</div>
            </div>
          </div>
        </div>
      </div>
      <div className="main-content">
        {/* Tab Navigation */}
        <div className="tab-navigation">
          <button
            onClick={() => setTab("activeTables")}
            className={`tab-btn ${tab === "activeTables" ? "active" : ""}`}
          >
            🏪 Active Tables
          </button>
          <button onClick={() => setTab("analytics")}
            className={`tab-btn ${tab === "analytics" ? "active" : ""}`}>
            📊 Today's Analytics
          </button>
          <button onClick={() => setTab("history")}
            className={`tab-btn ${tab === "history" ? "active" : ""}`}>
            📜 Today's History
          </button>
          <button onClick={() => setTab("dateReports")}
            className={`tab-btn ${tab === "dateReports" ? "active" : ""}`}>
            📅 Date-wise Reports
          </button>
          <button onClick={() => setTab("menu")}
            className={`tab-btn ${tab === "menu" ? "active" : ""}`}>
            🍔 Menu Management
          </button>
        </div>
        {/* Tab Content */}
        {tab === "activeTables" && (
          <div className="tab-content">
            {/* Table PINs Section */}
            <div className="section">
              <h3 className="section-title">📌 Table PINs</h3>
              <div className="table-pins-grid">
                {tableNumbers.map((table) => {
                  const pin = getPinForTable(table)
                  const active = isTableActive(table)
                  const tablePinDoc = tablePins.find((p) => p.table === table && !p.closed)
                  const closingRequested = tablePinDoc?.closingRequested || false
                  const pinBorderColor = closingRequested ? "#ff8c00" : active ? "#28a745" : "#6c757d"
                  const pinBackgroundColor = closingRequested ? "#ffe0b2" : active ? "#d4edda" : "#f8f9fa"
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
                          <button onClick={() => closeTable(table)}
                            className="close-table-btn">
                            ❌ Close Table
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="inactive-label">Inactive</div>
                          <button onClick={() => activateTable(table)}
                            className="activate-table-btn">
                            ✅ Activate Table
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Table Orders Section */}
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
                                    👤 {customer.name}
                                    {customer.phone && <span
                                      className="customer-phone">📱 {customer.phone}</span>}
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
                              <span
                                className="status-badge kitchen-badge">In Kitchen</span>
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
                      {individualTableItems.length > 0 ? (
                        <div className="items-section">
                          <h5 className="items-title">🔍 Item Details & Actions:</h5>
                          <div className="items-container">
                            {individualTableItems.map((group, idx) => (
                              <div key={idx} className="item-group">
                                <div className="item-details">
                                  <div className="item-info">
                                    <div
                                      className="item-name">{group.itemName}</div>
                                    <div className="item-stats">
                                      Ordered: {group.customerOrderedQty} •
                                      Confirmed: {group.currentQty}
                                    </div>
                                    <div
                                      className="item-customers">By: {[...new Set(group.customers)].join(", ")}</div>
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
                                      <span
                                        className="qty-display">{group.currentQty}</span>
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
                                      🍳
                                      Send {group.currentQty - group.pendingKitchenQty} to
                                      Kitchen
                                    </button>
                                    {/* Status Dropdown */}
                                    <select
                                      value={
                                        group.readyQty > 0
                                          ? "Ready"
                                          : group.pendingKitchenQty > 0
                                            ? "Preparing"
                                            : "Waiting"
                                      }
                                      onChange={(e) =>
                                        updateIndividualItemStatus(
                                          group.ids,
                                          e.target.value,
                                          group.sessionId,
                                          group.table,
                                        )
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
                      {totalBillForTable > 0 && (
                        <div className="bill-display">💰 Current Bill: ₹{totalBillForTable}</div>
                      )}
                      {/* Action Buttons */}
                      <div className="table-actions">
                        {totalBillForTable > 0 && (
                          <button onClick={() => handleViewBill(table)}
                            className="view-bill-btn">
                            🧾 View Bill
                          </button>
                        )}
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
        )}
        {tab === "analytics" && (
          <div className="tab-content">
            <div className="analytics-section">
              <h3 className="section-title">📊 Today's Analytics</h3>
              <div className="analytics-grid">
                <div className="analytics-card revenue-card">
                  <h4>Today's Revenue</h4>
                  <p className="analytics-number">₹{todayAnalytics.totalRevenue}</p>
                </div>
                <div className="analytics-card tables-card">
                  <h4>Active Tables</h4>
                  <p className="analytics-number">{todayAnalytics.totalActiveTables}</p>
                </div>
                <div className="analytics-card orders-card">
                  <h4>Orders Placed Today</h4>
                  <p className="analytics-number">{todayAnalytics.totalOrdersPlaced}</p>
                </div>
                <div className="analytics-card completed-card">
                  <h4>Completed Today</h4>
                  <p className="analytics-number">{todayAnalytics.totalCompletedOrders}</p>
                </div>
                <div className="analytics-card canceled-card">
                  <h4>Canceled Today</h4>
                  <p className="analytics-number">{todayAnalytics.totalCanceledItems}</p>
                </div>
              </div>
              <div className="top-items-card">
                <h4>📈 Today's Top Selling Items</h4>
                {todayAnalytics.itemSales.length > 0 ? (
                  <ul className="top-items-list">
                    {todayAnalytics.itemSales.slice(0, 5).map(([item, count], index) => (
                      <li key={item} className="top-item">
                        <span className="item-name">{item}</span>
                        <span className="item-count">{count} sold</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="no-data">No sales data available for today yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
        {tab === "history" && (
          <div className="tab-content">
            <div className="history-section">
              <h3 className="section-title">📜 Today's Order History</h3>
              {getTodayHistoryItems().length === 0 ? (
                <div className="no-history">
                  <h4>No order history available for today.</h4>
                  <p>Once orders are placed today, they will appear here.</p>
                </div>
              ) : (
                <div className="history-grid">
                  {getTodayHistoryItems().map((item) => (
                    <div key={item.id} className="history-card">
                      <div className="history-header">
                        <h4 className="history-title">
                          {item.itemName} (Table {item.table})
                        </h4>
                        <span
                          className="history-status"
                          style={{
                            backgroundColor: getStatusColor(item.kitchenStatus || item.status),
                            color: item.kitchenStatus === "Preparing" || item.status === "Pending" ? "#000" : "white",
                          }}
                        >
                          {getStatusText(item.kitchenStatus || item.status)}
                        </span>
                      </div>
                      <div className="history-details">
                        <p>Ordered by: {item.customerName || "N/A"}</p>
                        {item.customerPhone && <p>Phone: {item.customerPhone}</p>}
                        <p>Price: ₹{item.price}</p>
                        <p className="history-time">Placed: {formatTimestamp(item.created)}</p>
                        {item.updated && item.updated.seconds !== item.created.seconds && (
                          <p className="history-time">Last
                            Updated: {formatTimestamp(item.updated)}</p>
                        )}
                        {item.canceledBy &&
                          <p className="canceled-by">Canceled By: {item.canceledBy}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {tab === "dateReports" && (
          <div className="tab-content">
            <div className="date-reports-section">
              <h3 className="section-title">📅 Date-wise Reports</h3>
              {/* Date Selector */}
              <div className="date-selector">
                <label htmlFor="date-picker">Select Date:</label>
                <input
                  id="date-picker"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="date-input"
                />
              </div>
              {/* Selected Date Analytics */}
              <div className="selected-date-analytics">
                <h4 className="date-title">📊 Analytics for {selectedDate}</h4>
                <div className="analytics-grid">
                  <div className="analytics-card revenue-card">
                    <h4>Total Revenue</h4>
                    <p className="analytics-number">₹{selectedDateAnalytics.totalRevenue}</p>
                  </div>
                  <div className="analytics-card orders-card">
                    <h4>Orders Placed</h4>
                    <p className="analytics-number">{selectedDateAnalytics.totalOrdersPlaced}</p>
                  </div>
                  <div className="analytics-card completed-card">
                    <h4>Completed Orders</h4>
                    <p className="analytics-number">{selectedDateAnalytics.totalCompletedOrders}</p>
                  </div>
                  <div className="analytics-card canceled-card">
                    <h4>Canceled Items</h4>
                    <p className="analytics-number">{selectedDateAnalytics.totalCanceledItems}</p>
                  </div>
                </div>
                {/* Top Items for Selected Date */}
                <div className="top-items-card">
                  <h4>📈 Top Selling Items on {selectedDate}</h4>
                  {selectedDateAnalytics.itemSales.length > 0 ? (
                    <ul className="top-items-list">
                      {selectedDateAnalytics.itemSales.slice(0, 5).map(([item, count], index) => (
                        <li key={item} className="top-item">
                          <span className="item-name">{item}</span>
                          <span className="item-count">{count} sold</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="no-data">No sales data available for {selectedDate}.</p>
                  )}
                </div>
              </div>
              {/* Available Dates Summary */}
              <div className="available-dates">
                <h4 className="dates-title">📋 Available Report Dates</h4>
                {Object.keys(dateWiseData).length > 0 ? (
                  <div className="dates-grid">
                    {Object.entries(dateWiseData)
                      .sort(([a], [b]) => new Date(b) - new Date(a))
                      .slice(0, 10)
                      .map(([date, data]) => (
                        <div
                          key={date}
                          className={`date-card ${selectedDate === date ? "selected" : ""}`}
                          onClick={() => setSelectedDate(date)}
                        >
                          <div className="date-header">
                            <h5>{date}</h5>
                            <span className="date-revenue">₹{data.totalRevenue}</span>
                          </div>
                          <div className="date-stats">
                            <span>Orders: {data.items.length}</span>
                            <span>Completed: {data.completedOrders}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="no-data">No historical data available yet.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {tab === "menu" && (
          <div className="tab-content">
            <div className="section">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <h3 className="section-title">🍔 Menu Management</h3>
                {!isMenuInitialized && (
                  <button onClick={initializeMenuData} className="kitchen-btn" style={{ backgroundColor: "#007bff", fontSize: "14px" }}>
                    🚀 Initialize Default Menu
                  </button>
                )}
              </div>

              {/* Add New Category Section */}
              <div style={{
                marginBottom: "2rem",
                padding: "1.5rem",
                backgroundColor: "white",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                display: "flex",
                gap: "10px",
                alignItems: "center"
              }}>
                <h4 style={{ margin: 0, marginRight: "10px", color: "#343a40" }}>Create New Category:</h4>
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="e.g. Desserts"
                  style={{ padding: "0.8rem", borderRadius: "8px", border: "1px solid #ced4da", flex: 1, fontSize: "16px" }}
                />
                <button onClick={handleAddCategory} className="activate-table-btn" style={{ width: "auto", minWidth: "120px" }}>
                  + Add
                </button>
              </div>

              {/* Categories List (Accordion Style) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {menuCategories.map((category) => {
                  const isExpanded = expandedCategories[category.id]
                  const isEditingThisCategory = editingCategoryData && editingCategoryData.id === category.id

                  return (
                    <div key={category.id} style={{
                      backgroundColor: "white",
                      borderRadius: "12px",
                      overflow: "hidden",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
                      border: "1px solid #e9ecef"
                    }}>
                      {/* Accordion Header */}
                      <div
                        style={{
                          padding: "1.2rem",
                          backgroundColor: isExpanded ? "#f8f9fa" : "white",
                          borderBottom: isExpanded ? "1px solid #e9ecef" : "none",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          cursor: "pointer",
                          transition: "background-color 0.2s"
                        }}
                        onClick={() => !isEditingThisCategory && toggleCategory(category.id)}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "15px", flex: 1 }}>
                          <span style={{ fontSize: "1.5rem", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.3s" }}>
                            ▶
                          </span>
                          {isEditingThisCategory ? (
                            <div style={{ display: "flex", gap: "10px", flex: 1 }} onClick={(e) => e.stopPropagation()}>
                              <input
                                type="text"
                                value={editingCategoryData.name}
                                onChange={(e) => setEditingCategoryData({ ...editingCategoryData, name: e.target.value })}
                                style={{ padding: "0.5rem", fontSize: "1.1rem", borderRadius: "5px", border: "1px solid #007bff", width: "100%" }}
                                autoFocus
                              />
                              <button onClick={handleUpdateCategory} className="kitchen-btn" style={{ backgroundColor: "#28a745" }}>Save</button>
                              <button onClick={() => setEditingCategoryData(null)} className="kitchen-btn" style={{ backgroundColor: "#6c757d" }}>Cancel</button>
                            </div>
                          ) : (
                            <h4 style={{ margin: 0, fontSize: "1.3rem", color: "#343a40" }}>
                              {category.category} <span style={{ fontSize: "0.9rem", color: "#6c757d", fontWeight: "normal" }}>({category.items ? category.items.length : 0} items)</span>
                            </h4>
                          )}
                        </div>

                        {!isEditingThisCategory && (
                          <div style={{ display: "flex", gap: "10px" }} onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => setEditingCategoryData({ id: category.id, name: category.category })}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", opacity: 0.6 }}
                              title="Edit Name"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDeleteCategory(category.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", opacity: 0.6, color: "#dc3545" }}
                              title="Delete Category"
                            >
                              🗑️
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Accordion Body (Items) */}
                      {isExpanded && (
                        <div style={{ padding: "1.5rem", backgroundColor: "#fff" }}>
                          {/* Items Grid */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
                            {category.items && category.items.map((item, idx) => {
                              const isEditingThisItem = editingItem && editingItem.categoryId === category.id && editingItem.itemIndex === idx

                              if (isEditingThisItem) {
                                return (
                                  <div key={idx} style={{ padding: "1rem", backgroundColor: "#e3f2fd", borderRadius: "8px", border: "1px solid #90caf9", display: "flex", flexDirection: "column", gap: "10px" }}>
                                    <input
                                      type="text"
                                      value={editingItem.name}
                                      onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                                      placeholder="Item Name"
                                      style={{ padding: "0.5rem", borderRadius: "5px", border: "1px solid #ddd" }}
                                    />
                                    <input
                                      type="number"
                                      value={editingItem.price}
                                      onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                                      placeholder="Price"
                                      style={{ padding: "0.5rem", borderRadius: "5px", border: "1px solid #ddd" }}
                                    />
                                    <div style={{ display: "flex", gap: "5px" }}>
                                      <button onClick={handleUpdateItem} className="kitchen-btn" style={{ flex: 1, backgroundColor: "#28a745" }}>Save</button>
                                      <button onClick={() => setEditingItem(null)} className="kitchen-btn" style={{ flex: 1, backgroundColor: "#6c757d" }}>Cancel</button>
                                    </div>
                                  </div>
                                )
                              }

                              return (
                                <div key={idx} style={{ padding: "1rem", backgroundColor: "#f8f9fa", borderRadius: "8px", border: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center", transition: "all 0.2s hover" }}>
                                  <div>
                                    <div style={{ fontWeight: "bold", fontSize: "1.1rem", marginBottom: "4px" }}>{item.name}</div>
                                    <div style={{ fontSize: "1rem", color: "#28a745", fontWeight: "bold" }}>₹{item.price}</div>
                                  </div>
                                  <div style={{ display: "flex", gap: "5px" }}>
                                    <button
                                      onClick={() => setEditingItem({ categoryId: category.id, itemIndex: idx, name: item.name, price: item.price })}
                                      className="kitchen-btn"
                                      style={{ backgroundColor: "#ffc107", color: "#000", padding: "5px 10px", minWidth: "auto" }}
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      onClick={() => handleDeleteItem(category.id, idx)}
                                      className="kitchen-btn"
                                      style={{ backgroundColor: "#dc3545", padding: "5px 10px", minWidth: "auto" }}
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>

                          {/* Add New Item Form - Inside Category */}
                          <div style={{ padding: "1.5rem", backgroundColor: "#f1f3f5", borderRadius: "8px", border: "2px dashed #dee2e6" }}>
                            <h5 style={{ margin: "0 0 1rem 0", color: "#6c757d" }}>+ Add New Item to {category.category}</h5>
                            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                              <input
                                type="text"
                                placeholder="Item Name"
                                value={activeCategoryForAdd === category.id ? newItem.name : ""}
                                onChange={(e) => {
                                  setActiveCategoryForAdd(category.id);
                                  setNewItem({ ...newItem, name: e.target.value })
                                }}
                                style={{ padding: "0.8rem", borderRadius: "5px", border: "1px solid #ddd", flex: 2, minWidth: "200px" }}
                              />
                              <input
                                type="number"
                                placeholder="Price (₹)"
                                value={activeCategoryForAdd === category.id ? newItem.price : ""}
                                onChange={(e) => {
                                  setActiveCategoryForAdd(category.id);
                                  setNewItem({ ...newItem, price: e.target.value })
                                }}
                                style={{ padding: "0.8rem", borderRadius: "5px", border: "1px solid #ddd", flex: 1, minWidth: "100px" }}
                              />
                              <button
                                onClick={() => handleAddItem(category.id)}
                                className="activate-table-btn"
                                style={{ width: "auto", minWidth: "100px", fontSize: "14px" }}
                              >
                                Add Item
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Bill Viewer Modal */}
      {showBillModal && currentBillData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div id="bill-modal-content" className="bill-content">
              <div className="bill-header">
                <h3>ANANTH ANDHRA STYLE</h3>
                <h3>FAMILY RESTAURANT</h3>
                <p>#1403/153/3, venktala, IAF Sation,</p>
                <p>Bagalur cross, Banglore-63</p>
                <p>GSTIN: 29EIIPK2269B3Z5</p>
              </div>
              <hr className="bill-divider" />
              <div className="bill-info">
                <p>Name: {currentBillData.customerName}</p>
                <div className="bill-row">
                  <span>Date: {currentBillData.currentDate}</span>
                  <span>Table No.: {currentBillData.table}</span>
                </div>
                <div className="bill-row">
                  <span>{currentBillData.currentTime}</span>
                </div>
                <p>Cashier: biller</p>
              </div>
              <hr className="bill-divider" />
              <div className="bill-items-header">
                <span>Item</span>
                <span>Qty.</span>
                <span>Price</span>
                <span>Amount</span>
              </div>
              {currentBillData.groupedItems.map((item, index) => (
                <div key={index} className="bill-item">
                  <span>{item.itemName}</span>
                  <span>{item.currentQty}</span>
                  <span>₹{item.price.toFixed(2)}</span>
                  <span>₹{(item.price * item.currentQty).toFixed(2)}</span>
                </div>
              ))}
              <hr className="bill-divider" />
              <div className="bill-totals">
                <div className="bill-row">
                  <span>Sub Total:</span>
                  <span>₹{currentBillData.subTotal.toFixed(2)}</span>
                </div>
                <div className="bill-row">
                  <span>Total Qty: {currentBillData.totalQuantity}</span>
                  <span>Sub Total ₹{currentBillData.subTotal.toFixed(2)}</span>
                </div>
                <p>[Net Total inclusive of GST]</p>
              </div>
              <hr className="bill-divider" />
              <div className="bill-grand-total">
                <span>Grand Total</span>
                <span>₹{currentBillData.grandTotal.toFixed(2)}</span>
              </div>
              <p className="bill-footer">Thank You Visit Again!</p>
            </div>
            <div className="modal-actions">
              <button onClick={handlePrintModalBill} className="print-btn">
                🖨️ Print
              </button>
              <button onClick={() => setShowBillModal(false)} className="close-btn">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <style jsx>{`
        .owner-dashboard {
          min-height: 100vh;
          background-color: #f8f9fa;
        }
        .header {
          background-color: white;
          color: #333;
          padding: 20px;
          border-bottom: 1px solid #e9ecef;
          /* position: sticky; REMOVED */
          /* top: 0; REMOVED */
          /* z-index: 1000; REMOVED */
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
        .header-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .clear-data-btn, .clear-all-btn {
          padding: 12px 20px;
          background-color: #dc3545;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          transition: all 0.3s ease;
          min-width: 140px;
        }
        .clear-data-btn {
          background-color: #fd7e14;
        }
        .clear-data-btn:hover {
          background-color: #e8690b;
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
          scrollbar-width: none; /* Firefox */
        }
        .stats-grid::-webkit-scrollbar {
          display: none; /* Chrome/Safari */
        }
        .stat-card {
          min-width: 150px;
          flex: 0 0 auto; /* Prevent shrinking */
          padding: 15px;
          border-radius: 10px;
          text-align: center;
          border: 1px solid rgba(0,0,0,0.05);
        }
        .revenue {
          background-color: rgba(40, 167, 69, 0.2);
        }
        .active-tables {
          background-color: rgba(0, 123, 255, 0.2);
        }
        .ready-orders {
          background-color: rgba(40, 167, 69, 0.2);
        }
        .pending-orders {
          background-color: rgba(255, 193, 7, 0.2);
        }
        .completed-orders {
          background-color: rgba(108, 117, 125, 0.2);
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
        .tab-navigation {
          display: flex;
          margin-bottom: 20px;
          border-bottom: 2px solid #ddd;
          gap: 5px;
          flex-wrap: nowrap;
          overflow-x: auto;
          padding-bottom: 5px;
          scrollbar-width: none;
        }
        .tab-navigation::-webkit-scrollbar {
          display: none;
        }
        .tab-btn {
          padding: 12px 20px;
          border: none;
          background-color: transparent;
          color: #333;
          cursor: pointer;
          border-radius: 8px 8px 0 0;
          font-weight: bold;
          font-size: 14px;
          transition: all 0.3s ease;
          white-space: nowrap;
        }
        .tab-btn.active {
          background-color: #6f42c1;
          color: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .tab-btn:hover:not(.active) {
          background-color: #f8f9fa;
        }
        .section {
          margin-bottom: 40px;
        }
        .section-title {
          margin-bottom: 20px;
          color: #333;
          font-size: clamp(1.2rem, 3vw, 1.5rem);
          border-bottom: 3px solid #6f42c1;
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
          box-shadow: 0 2px 5px rgba(0,0,0,0.2);
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
          box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
        }
        .inactive-label {
          font-size: 16px;
          margin-bottom: 20px;
          color: #6c757d;
          font-style: italic;
        }
        .close-table-btn, .activate-table-btn {
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
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
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
          background-color: rgba(255,255,255,0.7);
          border-radius: 6px;
          font-size: 12px;
        }
        .customer-phone {
          margin-left: 8px;
          font-size: 12px;
        }
        .customer-status {
          font-size: 10px;
          margin-left: 8px;
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
          background-color: #f9f9f9;
        }
        .item-group {
          margin-bottom: 15px;
          padding: 15px;
          border: 1px solid #ddd;
          border-radius: 10px;
          background-color: white;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
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
        .item-stats, .item-customers {
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
          background-color: rgba(255,255,255,0.5);
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
          background-color: rgba(255,255,255,0.8);
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .table-actions {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        .view-bill-btn {
          flex: 1;
          padding: 12px 20px;
          background-color: #007bff;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
        }
        .view-bill-btn:hover {
          background-color: #0056b3;
        }
        .close-order-btn {
          flex: 1;
          padding: 12px 20px;
          background-color: #dc3545;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
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
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
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
        .analytics-section {
          padding: 20px;
          background-color: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .analytics-card {
          padding: 20px;
          background-color: #f8f9fa;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          text-align: center;
          transition: all 0.3s ease;
        }
        .analytics-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .analytics-card h4 {
          margin: 0 0 15px 0;
          color: #6f42c1;
          font-size: 16px;
        }
        .analytics-number {
          font-size: 32px;
          font-weight: bold;
          margin: 0;
        }
        .revenue-card .analytics-number {
          color: #28a745;
        }
        .tables-card .analytics-number {
          color: #17a2b8;
        }
        .orders-card .analytics-number {
          color: #ffc107;
        }
        .completed-card .analytics-number {
          color: #28a745;
        }
        .canceled-card .analytics-number {
          color: #dc3545;
        }
        .top-items-card {
          padding: 20px;
          background-color: #f8f9fa;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .top-items-card h4 {
          margin: 0 0 20px 0;
          color: #6f42c1;
          font-size: 18px;
        }
        .top-items-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .top-item {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #eee;
        }
        .top-item:last-child {
          border-bottom: none;
        }
        .item-name {
          font-weight: 500;
        }
        .item-count {
          font-weight: bold;
          color: #6f42c1;
        }
        .no-data {
          color: #6c757d;
          font-style: italic;
          text-align: center;
          margin: 0;
        }
        .history-section {
          padding: 20px;
          background-color: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .no-history {
          text-align: center;
          padding: 60px 20px;
          color: #6c757d;
        }
        .no-history h4 {
          margin: 0 0 15px 0;
          font-size: clamp(1.2rem, 3vw, 1.5rem);
        }
        .no-history p {
          margin: 0;
          font-size: clamp(0.9rem, 2vw, 1.1rem);
        }
        .history-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 20px;
        }
        .history-card {
          border: 1px solid #ddd;
          border-radius: 12px;
          padding: 20px;
          background-color: #f8f9fa;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
          transition: all 0.3s ease;
        }
        .history-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        .history-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
          flex-wrap: wrap;
          gap: 10px;
        }
        .history-title {
          margin: 0;
          font-size: 16px;
          color: #333;
        }
        .history-status {
          padding: 6px 12px;
          border-radius: 15px;
          font-size: 12px;
          font-weight: bold;
        }
        .history-details p {
          margin: 8px 0;
          font-size: 14px;
          color: #666;
        }
        .history-time {
          font-size: 12px !important;
          color: #999 !important;
        }
        .canceled-by {
          color: #dc3545 !important;
          font-weight: bold !important;
        }
        /* Date Reports Styles */
        .date-reports-section {
          padding: 20px;
          background-color: white;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .date-selector {
          margin-bottom: 30px;
          display: flex;
          align-items: center;
          gap: 15px;
          flex-wrap: wrap;
        }
        .date-selector label {
          font-weight: bold;
          color: #333;
          font-size: 16px;
        }
        .date-input {
          padding: 10px 15px;
          border: 2px solid #ddd;
          border-radius: 8px;
          font-size: 16px;
          background-color: white;
          cursor: pointer;
          transition: border-color 0.3s ease;
        }
        .date-input:focus {
          outline: none;
          border-color: #6f42c1;
        }
        .selected-date-analytics {
          margin-bottom: 40px;
        }
        .date-title {
          margin-bottom: 20px;
          color: #6f42c1;
          font-size: 20px;
          border-bottom: 2px solid #6f42c1;
          padding-bottom: 10px;
        }
        .analytics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .analytics-card {
          padding: 20px;
          background-color: #f8f9fa;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          text-align: center;
          transition: all 0.3s ease;
        }
        .analytics-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .analytics-card h4 {
          margin: 0 0 15px 0;
          color: #6f42c1;
          font-size: 16px;
        }
        .analytics-number {
          font-size: 32px;
          font-weight: bold;
          margin: 0;
        }
        .revenue-card .analytics-number {
          color: #28a745;
        }
        .tables-card .analytics-number {
          color: #17a2b8;
        }
        .orders-card .analytics-number {
          color: #ffc107;
        }
        .completed-card .analytics-number {
          color: #28a745;
        }
        .canceled-card .analytics-number {
          color: #dc3545;
        }
        .top-items-card {
          padding: 20px;
          background-color: #f8f9fa;
          border-radius: 10px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .top-items-card h4 {
          margin: 0 0 20px 0;
          color: #6f42c1;
          font-size: 18px;
        }
        .top-items-list {
          list-style: none;
          padding: 0;
          margin: 0;
        }
        .top-item {
          display: flex;
          justify-content: space-between;
          padding: 12px 0;
          border-bottom: 1px solid #eee;
        }
        .top-item:last-child {
          border-bottom: none;
        }
        .item-name {
          font-weight: 500;
        }
        .item-count {
          font-weight: bold;
          color: #6f42c1;
        }
        .no-data {
          color: #6c757d;
          font-style: italic;
          text-align: center;
          margin: 0;
        }
        .available-dates {
          margin-top: 40px;
        }
        .dates-title {
          margin-bottom: 20px;
          color: #333;
          font-size: 18px;
          border-bottom: 2px solid #ddd;
          padding-bottom: 10px;
        }
        .dates-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 15px;
        }
        .date-card {
          padding: 15px;
          border: 2px solid #ddd;
          border-radius: 10px;
          background-color: #f8f9fa;
          cursor: pointer;
          transition: all 0.3s ease;
        }
        .date-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          border-color: #6f42c1;
        }
        .date-card.selected {
          border-color: #6f42c1;
          background-color: #e8d5f7;
        }
        .date-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .date-header h5 {
          margin: 0;
          color: #333;
          font-size: 16px;
        }
        .date-revenue {
          font-weight: bold;
          color: #28a745;
          font-size: 14px;
        }
        .date-stats {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          color: #666;
        }
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0,0,0,0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background-color: white;
          padding: 20px;
          border-radius: 12px;
          max-width: 400px;
          width: 90%;
          box-shadow: 0 4px 15px rgba(0,0,0,0.2);
          display: flex;
          flex-direction: column;
          max-height: 90vh;
        }
        .bill-content {
          flex-grow: 1;
          overflow-y: auto;
          padding: 10px;
          font-family: 'Courier New', monospace;
          font-size: 12px;
        }
        .bill-header {
          text-align: center;
          margin-bottom: 15px;
        }
        .bill-header h3 {
          margin: 0;
          font-size: 16px;
        }
        .bill-header p {
          margin: 5px 0;
          font-size: 10px;
        }
        .bill-divider {
          border-top: 1px dashed #000;
          margin: 15px 0;
        }
        .bill-info p {
          margin: 8px 0;
        }
        .bill-row {
          display: flex;
          justify-content: space-between;
          margin: 8px 0;
        }
        .bill-items-header {
          display: flex;
          justify-content: space-between;
          font-weight: bold;
          margin-bottom: 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid #ddd;
        }
        .bill-items-header span:nth-child(1) { width: 40%; }
        .bill-items-header span:nth-child(2) { width: 15%; text-align: right; }
        .bill-items-header span:nth-child(3) { width: 20%; text-align: right; }
        .bill-items-header span:nth-child(4) { width: 25%; text-align: right; }
        .bill-item {
          display: flex;
          justify-content: space-between;
          margin: 5px 0;
        }
        .bill-item span:nth-child(1) { width: 40%; }
        .bill-item span:nth-child(2) { width: 15%; text-align: right; }
        .bill-item span:nth-child(3) { width: 20%; text-align: right; }
        .bill-item span:nth-child(4) { width: 25%; text-align: right; }
        .bill-totals {
          margin: 15px 0;
        }
        .bill-grand-total {
          display: flex;
          justify-content: space-between;
          font-size: 16px;
          font-weight: bold;
          margin: 15px 0;
        }
        .bill-footer {
          text-align: center;
          margin-top: 20px;
          font-weight: bold;
        }
        .modal-actions {
          display: flex;
          gap: 10px;
          margin-top: 20px;
        }
        .print-btn {
          flex: 1;
          padding: 12px 20px;
          background-color: #28a745;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
        }
        .print-btn:hover {
          background-color: #218838;
        }
        .close-btn {
          flex: 1;
          padding: 12px 20px;
          background-color: #6c757d;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: bold;
          transition: all 0.3s ease;
        }
        .close-btn:hover {
          background-color: #5a6268;
        }
        .connection-status {
          position: fixed;
          top: 10px;
          right: 10px;
          z-index: 1001;
          padding: 8px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: bold;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
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
          top: 80px;
          right: 10px;
          z-index: 1002;
          background-color: #6f42c1;
          color: white;
          padding: 15px;
          border-radius: 10px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
          background-color: rgba(255,255,255,0.2);
        }
        .blink-animation {
          animation: blink 2s infinite;
        }                
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0.7; }
        }                
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
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
          0%, 20%, 50%, 80%, 100% {
            transform: translateY(0);
          }
          40% {
            transform: translateY(-10px);
          }
          60% {
            transform: translateY(-5px);
          }
        }
        /* Mobile Responsive Styles */
        @media (max-width: 768px) {
          .header {
            padding: 15px;
          }
          .header-top {
            flex-direction: column;
            align-items: stretch;
            gap: 15px;
          }
          .header-actions {
            flex-direction: column;
            gap: 10px;
          }
          .clear-data-btn, .clear-all-btn {
            width: 100%;
            min-width: unset;
          }
          .stats-grid {
            grid-template-columns: repeat(2, 1fr);
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
          .tab-navigation {
            flex-direction: column;
            gap: 5px;
          }
          .tab-btn {
            padding: 10px 15px;
            border-radius: 8px;
          }
          .table-pins-grid {
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
          }
          .table-pin-card {
            padding: 12px;
          }
          .pin-display {
            font-size: 1.2rem;
          }
          .orders-grid {
            grid-template-columns: repeat(1, 1fr);
            gap: 15px;
          }
          .order-card {
            padding: 15px;
          }
          .item-details {
            flex-direction: column;
            align-items: flex-start;
          }
          .item-actions {
            flex-direction: row;
            justify-content: space-between;
            width: 100%;
          }
          .quantity-adjuster {
            margin-bottom: 10px;
          }
          .kitchen-btn {
            margin-bottom: 10px;
          }
          .status-select {
            width: 100%;
          }
          .analytics-grid {
            grid-template-columns: repeat(1, 1fr);
            gap: 15px;
          }
          .analytics-card {
            padding: 15px;
          }
          .analytics-number {
            font-size: 24px;
          }
          .date-selector {
            flex-direction: column;
            align-items: flex-start;
          }
          .date-input {
            width: 100%;
          }
          .dates-grid {
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }
          .date-card {
            padding: 12px;
          }
          .bill-content {
            font-size: 11px;
          }
          .bill-header h3 {
            font-size: 14px;
          }
          .bill-header p {
            font-size: 9px;
          }
          .bill-item {
            font-size: 11px;
          }
          .bill-grand-total {
            font-size: 14px;
          }
          .connection-status {
            top: auto;
            bottom: 10px;
            right: 10px;
          }
          .new-order-alert {
            top: auto;
            bottom: 80px;
            right: 10px;
          }
        }
      `}</style>
    </div>
  )
}
