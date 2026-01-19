"use client"
import { useState, useEffect, useRef, useMemo } from "react"
// Import useRef
import { db } from "../firebase"
import LoadingSpinner from "../data/loading-spinner" // Import LoadingSpinner

import {
  collection,
  addDoc,
  Timestamp,
  query,
  where,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
  orderBy, // Check if this was already imported
} from "firebase/firestore"


export default function CustomerMenu() {
  const [order, setOrder] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [customerName, setCustomerName] = useState("")
  const [customerPhone, setCustomerPhone] = useState("")
  const [tablePin, setTablePin] = useState("")
  const [showPinPrompt, setShowPinPrompt] = useState(false)
  const [infoSubmitted, setInfoSubmitted] = useState(false) // Default to false
  const [sessionClosed, setSessionClosed] = useState(false)
  const [tab, setTab] = useState("menu")
  const [tablePinData, setTablePinData] = useState(null)
  const [pinVerified, setPinVerified] = useState(false)
  const [orderData, setOrderData] = useState(null)
  const [individualItems, setIndividualItems] = useState([])
  // 🔹 Derived data (calculated from state)
  const finalBill = useMemo(() => {
    const grouped = {}

    individualItems
      .filter(i => i.status !== "Canceled" && i.kitchenStatus !== "Canceled")
      .forEach(item => {
        if (!grouped[item.itemName]) {
          grouped[item.itemName] = {
            name: item.itemName,
            price: item.price,
            qty: 0,
            totalPrice: 0
          }
        }
        grouped[item.itemName].qty += 1
        grouped[item.itemName].totalPrice += item.price
      })

    return Object.values(grouped)
  }, [individualItems])

  const [loading, setLoading] = useState(false) // New loading state
  const [menuItems, setMenuItems] = useState([]) // NEW: Menu items from Firestore
  const [activeCategory, setActiveCategory] = useState(null) // Dynamic active category
  const table = new URLSearchParams(window.location.search).get("table")

  // Key for localStorage to persist customer info per table
  const CUSTOMER_INFO_STORAGE_KEY = `customerInfo_table_${table}`
  const DRAFT_ORDER_STORAGE_KEY = `draftOrder_table_${table}`
  const INFO_SUBMITTED_STORAGE_KEY_PREFIX = `infoSubmitted_session_`
  const PIN_VERIFIED_STORAGE_KEY_PREFIX = `pinVerified_session_`

  // Ref to store the previous sessionId to detect changes without re-running effect
  const prevSessionIdRef = useRef(null)

  // State and ref for scroll-hide header
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)

  // Helper function for status colors
  const getStatusColor = (status) => {
    switch (status) {
      case "Waiting":
      case "Pending":
        return "#ffc107" // Yellow for pending/waiting
      case "Preparing":
      case "SentToKitchen":
        return "#17a2b8" // Blue for in progress
      case "Ready":
        return "#28a745" // Green for ready
      case "Canceled":
        return "#dc3545" // Red for canceled
      case "InfoSubmitted":
        return "#007bff" // Blue for info submitted
      default:
        return "#6c757d" // Grey for default/unknown
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
      default:
        return "Status Unknown"
    }
  }

  const getTotalItems = (list) => list.reduce((t, i) => t + i.qty, 0)

  // NEW: Fetch Menu Items from Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "menu"), (snapshot) => {
      const categories = snapshot.docs.map(doc => doc.data())
      setMenuItems(categories)
      // Set active category to first one if not set
      if (categories.length > 0) {
        setActiveCategory(prev => prev || categories[0].category)
      }
    })
    return () => unsubscribe()
  }, [])


  // Load customer info from localStorage on mount (for pre-filling, NOT setting infoSubmitted)
  useEffect(() => {
    if (typeof window !== "undefined" && table) {
      const storedInfo = localStorage.getItem(CUSTOMER_INFO_STORAGE_KEY)
      if (storedInfo) {
        const { name, phone } = JSON.parse(storedInfo)
        setCustomerName(name)
        setCustomerPhone(phone)
        console.log("CustomerMenu: Loaded customer info from localStorage (pre-filling fields):", { name, phone })
      } else {
        console.log("CustomerMenu: No customer info found in localStorage.")
        // If no stored info, ensure fields are empty on initial load for a new table
        setCustomerName("")
        setCustomerPhone("")
      }
    }
  }, [table, CUSTOMER_INFO_STORAGE_KEY])

  // Save customer info to localStorage when customerName or customerPhone changes
  useEffect(() => {
    if (typeof window !== "undefined" && customerName && customerPhone && table) {
      localStorage.setItem(CUSTOMER_INFO_STORAGE_KEY, JSON.stringify({ name: customerName, phone: customerPhone }))
      console.log("CustomerMenu: Saved customer info to localStorage:", { name: customerName, phone: customerPhone })
    }
  }, [customerName, customerPhone, table, CUSTOMER_INFO_STORAGE_KEY])

  // 🔹 NEW: Load draft order from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined" && table) {
      const storedOrder = localStorage.getItem(DRAFT_ORDER_STORAGE_KEY)
      if (storedOrder) {
        try {
          const parsedOrder = JSON.parse(storedOrder)
          if (Array.isArray(parsedOrder) && parsedOrder.length > 0) {
            setOrder(parsedOrder)
            console.log("CustomerMenu: Restored draft order from localStorage:", parsedOrder)
          }
        } catch (e) {
          console.error("CustomerMenu: Failed to parse stored order:", e)
        }
      }
    }
  }, [table, DRAFT_ORDER_STORAGE_KEY])

  // 🔹 NEW: Save draft order to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined" && table) {
      if (order.length > 0) {
        localStorage.setItem(DRAFT_ORDER_STORAGE_KEY, JSON.stringify(order))
        // console.log("CustomerMenu: Saved draft order to localStorage")
      } else {
        // If order is empty, remove the key so we don't load an empty array unnecessarily
        // But strictly speaking, if user deletes all items, we WANT empty array.
        // However, removing it is safer to avoid stale empty states if logic changes.
        // Let's keep it in sync.
        localStorage.setItem(DRAFT_ORDER_STORAGE_KEY, JSON.stringify([]))
      }
    }
  }, [order, table, DRAFT_ORDER_STORAGE_KEY])

  // Check if table has active session and get PIN data
  useEffect(() => {
    if (!table) {
      console.log("CustomerMenu: No table parameter found in URL.")
      return
    }
    console.log(`CustomerMenu: Listening for active session for table: ${table}`)
    const unsubscribe = onSnapshot(
      query(collection(db, "tablePins"), where("table", "==", table), where("closed", "==", false)),
      (snapshot) => {
        if (!snapshot.empty) {
          const pinDoc = snapshot.docs[0]
          const pinData = pinDoc.data()
          const newSessionId = pinData.sessionId
          // Only reset if we had a previous session (not initial load) AND the ID changed
          if (prevSessionIdRef.current !== null && newSessionId !== prevSessionIdRef.current) {
            console.log("CustomerMenu: New session ID detected (Session Changed). Clearing customer info and resetting infoSubmitted.")
            setCustomerName("")
            setCustomerPhone("")
            setInfoSubmitted(false) // Force re-submission for new session
            setPinVerified(false) // Also reset PIN verification
            // Clear draft order for new session
            localStorage.removeItem(DRAFT_ORDER_STORAGE_KEY)
            // Clear PIN verification for old session
            if (prevSessionIdRef.current) {
              localStorage.removeItem(`${PIN_VERIFIED_STORAGE_KEY_PREFIX}${prevSessionIdRef.current}`)
            }
            setOrder([])
          } else {
            // 🔹 NEW: Same session or Initial Load - check if we already submitted info
            if (newSessionId) {
              const submittedKey = `${INFO_SUBMITTED_STORAGE_KEY_PREFIX}${newSessionId}`
              const isSubmitted = localStorage.getItem(submittedKey) === "true"
              // If persisted as submitted, restore that state
              if (isSubmitted && !infoSubmitted) {
                console.log("CustomerMenu: Restoring infoSubmitted state from localStorage for this session.")
                setInfoSubmitted(true)
              }

              // 🔹 Restore PIN verification state for this session
              const pinVerifiedKey = `${PIN_VERIFIED_STORAGE_KEY_PREFIX}${newSessionId}`
              const isPinVerified = localStorage.getItem(pinVerifiedKey) === "true"
              if (isPinVerified && !pinVerified) {
                console.log("CustomerMenu: Restoring pinVerified state from localStorage for this session.")
                setPinVerified(true)
              }
            }
          }
          setTablePinData(pinData)
          setSessionId(newSessionId)
          prevSessionIdRef.current = newSessionId // Update ref with current sessionId
          console.log("CustomerMenu: Active session found:", pinData)
        } else {
          // No active session
          // If there was a session active before, clear everything
          if (prevSessionIdRef.current !== null) {
            // Check if there was a previous session
            console.log(
              "CustomerMenu: No active session found for this table. Resetting infoSubmitted and clearing customer info.",
            )
            setInfoSubmitted(false) // Revert to waiting state or form state
            setCustomerName("") // Clear name/phone when session closes
            setCustomerPhone("") // Clear name/phone when session closes
            setPinVerified(false) // Reset PIN verification
          }
          setTablePinData(null)
          setSessionId(null)
          prevSessionIdRef.current = null // Update ref
          console.log("CustomerMenu: No active session found for this table. Resetting infoSubmitted.")
        }
      },
    )
    return () => unsubscribe()
  }, [table]) // This effect now only depends on `table`

  // Listen to merged orders for overall status
  useEffect(() => {
    if (!sessionId) return
    console.log(`CustomerMenu: Listening to mergedOrders for sessionId: ${sessionId}`)
    const unsubscribe = onSnapshot(doc(db, "mergedOrders", sessionId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data()
        setOrderData(data)
        console.log("CustomerMenu: Merged order data updated:", data)
      } else {
        setOrderData(null)
        console.log("CustomerMenu: Merged order document does not exist.")
      }
    })
    return () => unsubscribe()
  }, [sessionId])

  // Listen to individual items for detailed status and to build the final bill
  useEffect(() => {
    if (!sessionId) return

    const unsubscribe = onSnapshot(
      query(collection(db, "individualItems"), where("sessionId", "==", sessionId)),
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        setIndividualItems(items)
      }
    )

    return () => unsubscribe()
  }, [sessionId])


  // Listen to scroll events to hide/show header
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY

      // Only hide if scrolling down and past a certain threshold (e.g., 50px)
      if (currentScrollY > lastScrollY.current && currentScrollY > 50) {
        setHeaderVisible(false)
      } else if (currentScrollY < lastScrollY.current) {
        // Always show if scrolling up
        setHeaderVisible(true)
      }
      lastScrollY.current = currentScrollY
    }

    if (typeof window !== "undefined") {
      window.addEventListener("scroll", handleScroll)
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("scroll", handleScroll)
      }
    }
  }, [])

  // Check if session is closed
  useEffect(() => {
    if (!table) return
    console.log(`CustomerMenu: Checking session closed status for table: ${table}`)
    const unsubscribe = onSnapshot(doc(db, "tablePins", table), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data()
        const isClosed = !!data.closed
        setSessionClosed(isClosed)

        if (isClosed) {
          console.log("CustomerMenu: Session closed detected. Clearing local data for fresh start.")
          // Clear data so next launch is "normal" (fresh inputs)
          localStorage.removeItem(CUSTOMER_INFO_STORAGE_KEY)
          localStorage.removeItem(DRAFT_ORDER_STORAGE_KEY)
          // Clear PIN verification for closed session
          if (sessionId) {
            localStorage.removeItem(`${PIN_VERIFIED_STORAGE_KEY_PREFIX}${sessionId}`)
          }
          setCustomerName("")
          setCustomerPhone("")
          setInfoSubmitted(false)
          setPinVerified(false)
          setOrder([])
        }
      }
    })
    return () => unsubscribe()
  }, [table, CUSTOMER_INFO_STORAGE_KEY, DRAFT_ORDER_STORAGE_KEY])

  const addItem = (item) => {
    const exists = order.find((i) => i.name === item.name)
    if (exists) {
      setOrder(order.map((i) => (i.name === item.name ? { ...i, qty: i.qty + 1 } : i)))
    } else {
      setOrder([...order, { ...item, qty: 1 }])
    }
    console.log("CustomerMenu: Item added to order:", item.name, "Current order:", order)
  }

  const removeItem = (itemName) => {
    const exists = order.find((i) => i.name === itemName)
    if (exists && exists.qty > 1) {
      setOrder(order.map((i) => (i.name === itemName ? { ...i, qty: i.qty - 1 } : i)))
    } else {
      setOrder(order.filter((i) => i.name !== itemName))
    }
    console.log("CustomerMenu: Item removed from order:", itemName, "Current order:", order)
  }

  const deleteItem = (itemName) => {
    setOrder(order.filter((i) => i.name !== itemName))
    console.log("CustomerMenu: Item deleted from order:", itemName, "Current order:", order)
  }

  const handleInitialSubmit = async () => {
    console.log("CustomerMenu: Attempting to submit initial info. Current sessionId:", sessionId)
    if (!customerName || !customerPhone) {
      alert("Please enter name and phone number.")
      return
    }
    if (!sessionId) {
      alert("No active session. Please contact waiter.")
      return
    }
    setLoading(true)
    try {
      await addDoc(collection(db, "orders"), {
        table,
        sessionId,
        customerName,
        customerPhone,
        items: [],
        status: "InfoSubmitted",
        sessionActive: true,
        created: Timestamp.now(),
      })
      setInfoSubmitted(true) // THIS IS THE KEY: Set infoSubmitted to true ONLY on successful submission
      // Save customer info to localStorage (already handled by separate useEffect)

      // 🔹 NEW: Persist the submission status for this session
      localStorage.setItem(`${INFO_SUBMITTED_STORAGE_KEY_PREFIX}${sessionId}`, "true")

      console.log("CustomerMenu: Customer info submitted successfully. infoSubmitted set to true.")
    } catch (error) {
      console.error("CustomerMenu: Error submitting customer info:", error)
      alert("❌ Failed to submit information. Please try again.") // Keep alert for critical errors
    } finally {
      setLoading(false)
    }
  }

  const submitOrder = async () => {
    if (!order.length) {
      alert("Please add items to your order.")
      return
    }
    if (!tablePinData) {
      alert("No active session for this table. Please contact waiter.")
      return
    }
    if (pinVerified) {
      await placeOrderDirectly()
    } else {
      setShowPinPrompt(true)
    }
    console.log("CustomerMenu: Submit order initiated.")
  }

  const placeOrderDirectly = async () => {
    setLoading(true)

    try {
      // 1️⃣ Create main order document (single write)
      await addDoc(collection(db, "orders"), {
        table,
        sessionId,
        items: order,
        status: "Pending",
        sessionActive: true,
        created: Timestamp.now(),
        customerName,
        customerPhone,
      })

      // 2️⃣ Batch write for individual items (FAST)
      const batch = writeBatch(db)

      order.forEach((item) => {
        for (let i = 0; i < item.qty; i++) {
          const itemRef = doc(collection(db, "individualItems"))

          batch.set(itemRef, {
            table,
            sessionId,
            itemName: item.name,
            price: item.price,
            customerName,
            customerPhone,
            status: "Pending",
            kitchenStatus: "Waiting",
            created: Timestamp.now(),
            itemId: `${item.name}_${customerName}_${Date.now()}_${i}`,
          })
        }
      })

      // 3️⃣ Commit batch (ONE network request)
      await batch.commit()

      // 4️⃣ Fire merged order update WITHOUT blocking UI
      updateMergedOrders() // ❌ no await (important)

      // 5️⃣ Clear UI state immediately
      setOrder([])
      // 🔹 NEW: Clear draft order from storage since it's now placed
      localStorage.removeItem(DRAFT_ORDER_STORAGE_KEY)

    } catch (error) {
      console.error("CustomerMenu: Error placing order:", error)
      alert("❌ Failed to place order. Please try again.")
    } finally {
      // 6️⃣ Close loader quickly (UI feels instant)
      setTimeout(() => {
        setLoading(false)
      }, 300)
    }
  }


  const confirmOrderWithPin = async () => {
    if (!tablePin) {
      alert("Please enter table PIN.")
      return
    }
    if (!tablePinData || tablePinData.pin !== tablePin) {
      alert("❌ Invalid PIN.")
      return
    }
    // setLoading(true)
    try {
      setPinVerified(true)
      // 🔹 Persist PIN verification to localStorage for this session
      if (sessionId) {
        localStorage.setItem(`${PIN_VERIFIED_STORAGE_KEY_PREFIX}${sessionId}`, "true")
        console.log("CustomerMenu: PIN verification saved to localStorage for session:", sessionId)
      }
      await placeOrderDirectly()
      setShowPinPrompt(false)
      setTablePin("")
      console.log("CustomerMenu: Order confirmed with PIN.")
    } catch (error) {
      console.error("CustomerMenu: Error confirming PIN and placing order:", error)
      alert("❌ Failed to confirm PIN or place order. Please try again.")
    }
    // finally {
    //   setLoading(false)
    // }
  }

  const handleDineClose = async () => {
    if (!sessionId || !table) {
      alert("No active session to close.")
      return
    }
    setLoading(true)
    try {
      await updateDoc(doc(db, "tablePins", table), {
        closingRequested: true,
        closingRequestedAt: Timestamp.now(),
      })
      console.log("CustomerMenu: Dine close requested.")
    } catch (error) {
      console.error("CustomerMenu: Error requesting dine close:", error)
      alert("❌ Failed to request dine close. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const updateMergedOrders = async () => {
    const individualItemsForSession = individualItems.filter(
      (item) => item.sessionId === sessionId && item.kitchenStatus !== "Canceled" && item.status !== "Canceled",
    )
    const combinedItems = {}
    individualItemsForSession.forEach((item) => {
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
    console.log("CustomerMenu: Merged orders updated.")
  }

  const getTotalPrice = (list) => list.reduce((t, i) => t + i.price * i.qty, 0)
  // const getTotalItems = (list) => list.reduce((t, i) => t + i.qty, 0)

  const groupedIndividualItems = useMemo(() => {
    return individualItems.reduce((acc, item) => {
      const statusToDisplay = item.kitchenStatus || item.status
      const key = `${item.itemName}-${statusToDisplay}`

      if (!acc[key]) {
        acc[key] = {
          itemName: item.itemName,
          price: item.price,
          status: statusToDisplay,
          customers: [],
          count: 0,
          totalPrice: 0,
        }
      }

      acc[key].customers.push(item.customerName)
      acc[key].count += 1
      acc[key].totalPrice += item.price

      return acc
    }, {})
  }, [individualItems])


  // NEW: Get items for the currently active category
  const currentCategoryItems = menuItems.find((categoryData) => categoryData.category === activeCategory)?.items || []

  // --- Conditional Rendering Logic ---
  console.log(
    `CustomerMenu: Rendering decision - tablePinData: ${!!tablePinData}, infoSubmitted: ${infoSubmitted}, sessionClosed: ${sessionClosed}`,
  )

  if (sessionClosed) {
    console.log("CustomerMenu: Displaying Session Closed screen.")
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#f0f2f5",
        }}
      >
        {/* Logo and Name Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "15px",
            marginBottom: "2rem",
          }}
        >
          <img
            src="/logo.png"
            alt="Restaurant Logo"
            style={{
              height: "80px",
              width: "auto",
            }}
          />
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: "#343a40",
              }}
            >
              ANANTH ANDHRA STYLE
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "#6c757d",
              }}
            >
              Family Restaurant
            </p>
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: "1.8rem", color: "#28a745", marginBottom: "1rem" }}>✅ Table Session Closed</h2>
          <p style={{ fontSize: "1.1rem", color: "#555", marginBottom: "0.5rem" }}>Thank you for dining with us!</p>
          <p style={{ fontSize: "1.1rem", color: "#555" }}>This table is now available for new customers.</p>
        </div>
      </div>
    )
  }

  if (!tablePinData) {
    console.log("CustomerMenu: Displaying Waiting for Waiter screen.")
    return (
      <div
        style={{
          padding: "1.5rem",
          textAlign: "center",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#f0f2f5",
        }}
      >
        {/* Logo and Name Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "15px",
            marginBottom: "2rem",
          }}
        >
          <img
            src="/logo.png"
            alt="Restaurant Logo"
            style={{
              height: "80px",
              width: "auto",
            }}
          />
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: "1.5rem",
                fontWeight: "bold",
                color: "#343a40",
              }}
            >
              ANANTH ANDHRA STYLE
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: "0.9rem",
                color: "#6c757d",
              }}
            >
              Family Restaurant
            </p>
          </div>
        </div>
        <div>
          <h2 style={{ fontSize: "1.8rem", color: "#007bff", marginBottom: "1rem" }}>Table {table}</h2>
          <p style={{ fontSize: "1.1rem", color: "#6c757d", marginBottom: "0.5rem" }}>
            ⏳ Waiting for waiter to activate this table...
          </p>
          <p style={{ fontSize: "1.1rem", color: "#6c757d" }}>Please contact your waiter to get started.</p>
        </div>
      </div>
    )
  }

  // If tablePinData is available (table is active)
  // Then we check if infoSubmitted is true or false to show the form or the menu
  console.log("CustomerMenu: Displaying Active Table content.")
  return (
    <div style={{ backgroundColor: "#f5f5f5", minHeight: "100vh" }}>
      {loading && <LoadingSpinner />}
      {/* Logo and Name Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "15px",
          padding: "1rem",
          paddingTop: "1.5rem",
        }}
      >
        <img
          src="/logo.png"
          alt="Restaurant Logo"
          style={{
            height: "80px",
            width: "auto",
          }}
        />
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: "bold",
              color: "#343a40",
            }}
          >
            ANANTH ANDHRA STYLE
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: "0.9rem",
              color: "#6c757d",
            }}
          >
            Family Restaurant
          </p>
        </div>
      </div>
      {/* Main Content */}
      <div style={{ padding: "1rem", paddingBottom: "15rem" }}>
        <h2 style={{ fontSize: "1.8rem", marginBottom: "0.5rem", color: "#343a40" }}>Table {table}</h2>
        <p style={{ color: "#28a745", fontWeight: "bold", fontSize: "1rem", marginBottom: "1.5rem" }}>
          ✅ Table is Active - Ready to Order!
        </p>
        {!infoSubmitted ? (
          <div
            style={{
              marginBottom: "1.5rem",
              padding: "1rem",
              backgroundColor: "#ffffff",
              borderRadius: "8px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold", color: "#343a40" }}>
                Full Name *
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Enter your name"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #ced4da",
                  borderRadius: "5px",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: "bold", color: "#343a40" }}>
                Phone Number *
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="Enter your phone number"
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  border: "1px solid #ced4da",
                  borderRadius: "5px",
                  fontSize: "1rem",
                  boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={handleInitialSubmit}
              disabled={!sessionId} // Disable if sessionId is not available
              style={{
                width: "100%",
                padding: "0.8rem 1.2rem",
                backgroundColor: sessionId ? "#007bff" : "#cccccc", // Change color when disabled
                color: "white",
                border: "none",
                borderRadius: "5px",
                fontSize: "1.1rem",
                cursor: sessionId ? "pointer" : "not-allowed", // Change cursor when disabled
                transition: "background-color 0.2s ease",
              }}
            >
              Submit Information & Continue
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                marginBottom: "1.5rem",
                padding: "1rem",
                backgroundColor: "#e7f3ff",
                borderRadius: "8px",
                border: "1px solid #cce5ff",
                boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
              }}
            >
              <p style={{ margin: 0, fontSize: "0.95rem", color: "#004085" }}>
                <strong>Welcome, {customerName}!</strong> 📱 {customerPhone}
              </p>
            </div>
            {tab === "menu" && (
              <>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#343a40" }}>🍽️ Menu</h3>
                {/* Category Tabs */}
                <div
                  style={{
                    display: "flex",
                    overflowX: "auto",
                    marginBottom: "1.5rem",
                    borderBottom: "1px solid #e9ecef",
                    paddingBottom: "0.8rem",
                    scrollbarWidth: "none" /* Firefox */,
                    msOverflowStyle: "none" /* IE and Edge */,
                  }}
                >
                  {/* Hide scrollbar for Webkit browsers */}
                  <style>{`
                    div::-webkit-scrollbar {
                      display: none;
                    }
                  `}</style>
                  {menuItems.map((categoryData) => (
                    <button
                      key={categoryData.category}
                      onClick={() => setActiveCategory(categoryData.category)}
                      style={{
                        padding: "0.6rem 1rem",
                        marginRight: "0.6rem",
                        border: "none",
                        borderRadius: "20px",
                        cursor: "pointer",
                        backgroundColor: activeCategory === categoryData.category ? "#007bff" : "#e9ecef",
                        color: activeCategory === categoryData.category ? "white" : "#495057",
                        fontWeight: "bold",
                        flexShrink: 0,
                        fontSize: "0.9rem",
                        transition: "background-color 0.2s ease, color 0.2s ease",
                      }}
                    >
                      {categoryData.category}
                    </button>
                  ))}
                </div>
                <div style={{ marginBottom: "1.5rem" }}>
                  {currentCategoryItems.map((item) => {
                    const inOrder = order.find((i) => i.name === item.name)
                    return (
                      <div
                        key={item.name}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          padding: "1rem",
                          border: "1px solid #e9ecef",
                          marginBottom: "0.8rem",
                          borderRadius: "8px",
                          backgroundColor: "#ffffff",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                        }}
                      >
                        <div>
                          <strong style={{ fontSize: "1.1rem", color: "#343a40" }}>{item.name}</strong>
                          <div style={{ fontSize: "0.9rem", color: "#6c757d", marginTop: "0.25rem" }}>
                            ₹{item.price} per item
                          </div>
                        </div>
                        {inOrder ? (
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <button
                              onClick={() => removeItem(item.name)}
                              style={{
                                padding: "0.4rem 0.7rem",
                                backgroundColor: "#dc3545",
                                color: "white",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                fontSize: "1rem",
                                transition: "background-color 0.2s ease",
                              }}
                            >
                              -
                            </button>
                            <span
                              style={{
                                minWidth: "1.5rem",
                                textAlign: "center",
                                fontWeight: "bold",
                                fontSize: "1.1rem",
                              }}
                            >
                              {inOrder.qty}
                            </span>
                            <button
                              onClick={() => addItem(item)}
                              style={{
                                padding: "0.4rem 0.7rem",
                                backgroundColor: "#28a745",
                                color: "white",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                fontSize: "1rem",
                                transition: "background-color 0.2s ease",
                              }}
                            >
                              +
                            </button>
                            <button
                              onClick={() => deleteItem(item.name)}
                              style={{
                                padding: "0.4rem 0.7rem",
                                backgroundColor: "#6c757d",
                                color: "white",
                                border: "none",
                                borderRadius: "5px",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                                transition: "background-color 0.2s ease",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => addItem(item)}
                            style={{
                              padding: "0.6rem 1rem",
                              backgroundColor: "#007bff",
                              color: "white",
                              border: "none",
                              borderRadius: "5px",
                              cursor: "pointer",
                              fontSize: "1rem",
                              transition: "background-color 0.2s ease",
                            }}
                          >
                            Add
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
                {order.length > 0 && (
                  <div
                    style={{
                      position: "fixed",
                      bottom: "4.5rem" /* Adjusted to account for bottom nav */,
                      left: "1rem",
                      right: "1rem",
                      backgroundColor: "#ffffff",
                      padding: "1rem",
                      borderRadius: "10px",
                      boxShadow: "0 -4px 15px rgba(0,0,0,0.1)",
                      zIndex: 999 /* Ensure it's above other content but below modals */,
                    }}
                  >
                    <h4 style={{ fontSize: "1.1rem", marginBottom: "0.75rem", color: "#343a40" }}>
                      🛒 Current Order: <span style={{ color: "#007bff" }}>{getTotalItems(order)} items</span> •{" "}
                      <span style={{ color: "#28a745" }}>₹{getTotalPrice(order)}</span>
                    </h4>
                    {order.length > 0 && (
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "#666",
                          marginBottom: "0.75rem",
                          maxHeight: "8rem",
                          overflowY: "auto",
                        }}
                      >
                        {order.map((item, idx) => (
                          <div
                            key={idx}
                            style={{ display: "flex", justifyContent: "space-between", padding: "0.2rem 0" }}
                          >
                            <span>
                              {item.name} x {item.qty}
                            </span>
                            <span>
                              ₹{item.price} each = ₹{(item.price * item.qty).toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {pinVerified && (
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "#28a745",
                          textAlign: "center",
                          marginBottom: "0.5rem",
                          fontWeight: "bold",
                        }}
                      >
                        ✅ PIN Verified - Quick ordering enabled
                      </div>
                    )}
                    <button
                      onClick={submitOrder}
                      style={{
                        width: "100%",
                        padding: "0.8rem 1.2rem",
                        backgroundColor: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "5px",
                        fontSize: "1rem",
                        cursor: "pointer",
                        transition: "background-color 0.2s ease",
                      }}
                    >
                      {pinVerified ? "Place Order" : "Place Order (PIN Required)"}
                    </button>
                  </div>
                )}
                {showPinPrompt && (
                  <div
                    style={{
                      position: "fixed",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: "rgba(0,0,0,0.6)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 1001,
                    }}
                  >
                    <div
                      style={{
                        backgroundColor: "white",
                        padding: "1.5rem",
                        borderRadius: "10px",
                        width: "90%",
                        maxWidth: "20rem",
                        boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
                        textAlign: "center",
                      }}
                    >
                      <h4 style={{ fontSize: "1.3rem", marginBottom: "0.75rem", color: "#343a40" }}>Enter Table PIN</h4>
                      <p style={{ fontSize: "0.9rem", color: "#6c757d", marginBottom: "1rem" }}>
                        Ask your waiter for the table PIN to confirm your order
                      </p>
                      <input
                        type="text"
                        placeholder="Table PIN"
                        value={tablePin}
                        onChange={(e) => setTablePin(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "0.75rem",
                          marginBottom: "1rem",
                          border: "1px solid #ced4da",
                          borderRadius: "5px",
                          textAlign: "center",
                          fontSize: "1.2rem",
                          boxSizing: "border-box",
                        }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button
                          onClick={() => setShowPinPrompt(false)}
                          style={{
                            flex: 1,
                            padding: "0.75rem",
                            backgroundColor: "#6c757d",
                            color: "white",
                            border: "none",
                            borderRadius: "5px",
                            cursor: "pointer",
                            fontSize: "1rem",
                            transition: "background-color 0.2s ease",
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={confirmOrderWithPin}
                          style={{
                            flex: 1,
                            padding: "0.75rem",
                            backgroundColor: "#28a745",
                            color: "white",
                            border: "none",
                            borderRadius: "5px",
                            cursor: "pointer",
                            fontSize: "1rem",
                            transition: "background-color 0.2s ease",
                          }}
                        >
                          Confirm Order
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {tab === "checkout" && (
              <div>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "1rem", color: "#343a40" }}>🧾 Final Bill</h3>
                {/* Overall Order Status Display */}
                {orderData && (orderData.status || orderData.kitchenStatus) && (
                  <div
                    style={{
                      marginBottom: "1.5rem",
                      padding: "1rem",
                      backgroundColor: "#e9f5ff",
                      borderRadius: "10px",
                      border: "2px solid #a7d9ff",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                    }}
                  >
                    <h4 style={{ margin: "0 0 0.75rem 0", color: "#0056b3", fontSize: "1.1rem" }}>
                      📋 Overall Order Status
                    </h4>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        padding: "0.8rem",
                        backgroundColor: getStatusColor(orderData.kitchenStatus || orderData.status),
                        color:
                          orderData.kitchenStatus === "Preparing" || orderData.status === "Pending" ? "#000" : "white",
                        borderRadius: "8px",
                        fontWeight: "bold",
                        fontSize: "1rem",
                        justifyContent: "center",
                      }}
                    >
                      <span>{getStatusText(orderData.kitchenStatus || orderData.status)}</span>
                    </div>
                  </div>
                )}
                {/* Individual Item Status Display */}
                {Object.keys(groupedIndividualItems).length > 0 && (
                  <div style={{ marginBottom: "1.5rem" }}>
                    <h4 style={{ marginBottom: "1rem", color: "#343a40", fontSize: "1.1rem" }}>
                      📋 Individual Item Status:
                    </h4>
                    {Object.values(groupedIndividualItems).map((group, i) => (
                      <div
                        key={i}
                        style={{
                          marginBottom: "0.8rem",
                          padding: "1rem",
                          border: "1px solid #e9ecef",
                          borderRadius: "8px",
                          backgroundColor: "#ffffff",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: "0.75rem",
                          }}
                        >
                          <div>
                            <h5 style={{ margin: "0 0 0.25rem 0", fontSize: "1rem", color: "#343a40" }}>
                              {group.itemName}
                            </h5>
                            <div style={{ fontSize: "0.85rem", color: "#6c757d" }}>
                              ₹{group.price} each × {group.count} items = ₹{group.totalPrice.toFixed(2)}
                            </div>
                            <div style={{ fontSize: "0.85rem", color: "#6c757d", marginTop: "0.2rem" }}>
                              Ordered by: {[...new Set(group.customers)].join(", ")}
                            </div>
                          </div>
                          <div
                            style={{
                              padding: "0.4rem 0.8rem",
                              backgroundColor: getStatusColor(group.status),
                              color: group.status === "Pending" || group.status === "Preparing" ? "#000" : "white",
                              borderRadius: "15px",
                              fontSize: "0.8rem",
                              fontWeight: "bold",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {getStatusText(group.status)}
                          </div>
                        </div>
                        {group.status === "Ready" && (
                          <div
                            style={{
                              marginTop: "0.5rem",
                              padding: "0.6rem",
                              backgroundColor: "#d4edda",
                              color: "#155724",
                              borderRadius: "5px",
                              fontSize: "0.85rem",
                              textAlign: "center",
                              fontWeight: "bold",
                            }}
                          >
                            🍽️ Ready for pickup!
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {/* Final Bill Display (now derived from non-canceled individual items) */}
                {finalBill.length > 0 ? (
                  <>
                    <div style={{ marginBottom: "1.5rem" }}>
                      <h4 style={{ marginBottom: "0.75rem", color: "#343a40", fontSize: "1.1rem" }}>
                        📋 Order Summary:
                      </h4>
                      <ul
                        style={{
                          listStyle: "none",
                          padding: 0,
                          backgroundColor: "#ffffff",
                          borderRadius: "8px",
                          boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
                        }}
                      >
                        {finalBill.map((item, i) => (
                          <li
                            key={i}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              padding: "0.8rem 1rem",
                              borderBottom: "1px solid #eee",
                              alignItems: "center",
                            }}
                          >
                            <div>
                              <span style={{ fontWeight: "bold", fontSize: "1rem", color: "#343a40" }}>
                                {item.name}
                              </span>
                              <div style={{ fontSize: "0.85rem", color: "#6c757d", marginTop: "0.1rem" }}>
                                ₹{item.price} × {item.qty} items
                              </div>
                            </div>
                            <span style={{ fontWeight: "bold", fontSize: "1rem", color: "#28a745" }}>
                              ₹{(item.price * item.qty).toFixed(2)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div
                      style={{
                        fontSize: "1.3rem",
                        fontWeight: "bold",
                        textAlign: "right",
                        marginTop: "1rem",
                        padding: "1rem",
                        borderTop: "3px solid #007bff",
                        backgroundColor: "#e9f5ff",
                        borderRadius: "8px",
                        paddingRight: "1rem",
                        color: "#0056b3",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                      }}
                    >
                      Total Amount: ₹{getTotalPrice(finalBill).toFixed(2)}
                    </div>
                    {/* NEW: Dine Close Button */}
                    <button
                      onClick={handleDineClose}
                      style={{
                        width: "100%",
                        padding: "0.8rem 1.2rem",
                        backgroundColor: "#007bff",
                        color: "white",
                        border: "none",
                        borderRadius: "5px",
                        fontSize: "1.1rem",
                        marginTop: "1.5rem",
                        cursor: "pointer",
                        transition: "background-color 0.2s ease",
                      }}
                    >
                      🛎️ Request Dine Close
                    </button>
                  </>
                ) : (
                  <div
                    style={{
                      textAlign: "center",
                      padding: "2rem",
                      backgroundColor: "#ffffff",
                      borderRadius: "10px",
                      color: "#6c757d",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                    }}
                  >
                    <h4 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
                      No orders placed yet or all items canceled.
                    </h4>
                    <p style={{ fontSize: "0.95rem" }}>Go to the menu tab to place your first order!</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {infoSubmitted && (
          <div
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "space-around",
              backgroundColor: "#ffffff",
              padding: "0.75rem 1rem",
              borderTop: "1px solid #e9ecef",
              boxShadow: "0 -2px 10px rgba(0,0,0,0.1)",
              zIndex: 1000 /* Ensure it's always on top */,
            }}
          >
            <button
              onClick={() => setTab("menu")}
              style={{
                flex: 1,
                padding: "0.75rem 1rem",
                backgroundColor: tab === "menu" ? "#007bff" : "#e9ecef",
                color: tab === "menu" ? "white" : "#495057",
                border: "none",
                borderRadius: "5px",
                marginRight: "0.5rem",
                fontSize: "1rem",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "background-color 0.2s ease, color 0.2s ease",
              }}
            >
              🍽️ Menu
            </button>
            <button
              onClick={() => setTab("checkout")}
              style={{
                flex: 1,
                padding: "0.75rem 1rem",
                backgroundColor: tab === "checkout" ? "#007bff" : "#e9ecef",
                color: tab === "checkout" ? "white" : "#495057",
                border: "none",
                borderRadius: "5px",
                marginLeft: "0.5rem",
                fontSize: "1rem",
                fontWeight: "bold",
                cursor: "pointer",
                transition: "background-color 0.2s ease, color 0.2s ease",
              }}
            >
              🧾 Bill
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
