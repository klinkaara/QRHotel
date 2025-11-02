// Replace with your Firebase config
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDXB7lRShGebWPkF_60foPuW05FrmVNxEY",
  authDomain: "hotel-b75d5.firebaseapp.com",
  projectId: "hotel-b75d5",
  storageBucket: "hotel-b75d5.firebasestorage.app",
  messagingSenderId: "52171852135",
  appId: "1:52171852135:web:8c398339f0621ea08647c2",
  measurementId: "G-KLQQESC6LD",
  databaseURL: "https://hotel-b75d5-default-rtdb.firebaseio.com",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
