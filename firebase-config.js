// ============================================================
//  Firebase Configuration — ELECTRIC 7 POMI
//  PENTING: Ganti nilai di bawah dengan config dari Firebase Console Anda
//  1. Buka https://console.firebase.google.com
//  2. Buat project baru (atau pakai yang sudah ada)
//  3. Tambahkan Web App
//  4. Copy firebaseConfig dan paste di bawah
//  5. Aktifkan Firestore Database di Firebase Console
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyB2c5ZFYRH8rKRcYlza175wTM36O8jwDGw",
  authDomain: "pomi-checksheet-e7.firebaseapp.com",
  projectId: "pomi-checksheet-e7",
  storageBucket: "pomi-checksheet-e7.firebasestorage.app",
  messagingSenderId: "459830825503",
  appId: "1:459830825503:web:ef9356faa62b632f87fb2a"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
