// src/firebase.js
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBIMSTk0HZAh66Kyw8YPtEKj1BT--qnmRk",
  authDomain: "dinnerplate-1ac9d.firebaseapp.com",
  projectId: "dinnerplate-1ac9d",
  storageBucket: "dinnerplate-1ac9d.appspot.com",
  messagingSenderId: "313286569362",
  appId: "1:313286569362:web:33dce894d4147c525ee54b",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
