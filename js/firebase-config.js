// إعداد وربط Firebase بالاستوديو
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getDatabase, ref, set, get, update, push, remove, onValue, child } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// إعدادات Firebase الخاصة بالاستوديو
const firebaseConfig = {
  apiKey: "AIzaSyDLYifYJstznc00o_3WcvM_PqtGeTZLCGo",
  authDomain: "artiatech-management.firebaseapp.com",
  projectId: "artiatech-management",
  databaseURL: "https://artiatech-management-default-rtdb.firebaseio.com",
  storageBucket: "artiatech-management.firebasestorage.app",
  messagingSenderId: "212665480212",
  appId: "1:212665480212:web:9df26e2d5a081d5dc26301",
  measurementId: "G-QG9JZGREK0"
};

// تهيئة Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export { db, ref, set, get, update, push, remove, onValue, child };
