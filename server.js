// ========================================
// SERVEUR MBOANKAP - BACKEND CAMPY
// ========================================
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// ========================================
// INITIALISATION FIREBASE ADMIN
// ========================================
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
};

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin initialisé');
} catch (error) {
  console.error('⚠️ Erreur Firebase Admin:', error.message);
}

const db = admin.firestore();

// ========================================
// CONFIGURATION CAMPY
// ========================================
const CAMPY_BASE_URL = 'https://demo.campay.net/api';
const CAMPY_TOKEN = process.env.CAMPY_TOKEN;

// ========================================
// ROUTE 1 : INITIER UN PAIEMENT
// ========================================
app.post('/api/payer', async (req, res) => {
  try {
    const {
      tontineId,
      cotisationId,
      membreId,
      membreNom,
      telephone,
      montant,
      methode,
    } = req.body;

    console.log('🚀 Initiation paiement:', {
      membreNom,
      telephone,
      montant,
      methode,
    });

    // 1. Appeler Campy
    const campyResponse = await axios.post(
      `${CAMPY_BASE_URL}/collect/`,
      {
        amount: montant.toString(),
        currency: 'XAF',
        from: telephone,
        description: `Cotisation ${membreNom} - ${tontineId}`,
        external_reference: cotisationId,
      },
      {
        headers: {
          'Authorization': `Token ${CAMPY_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Réponse Campy:', campyResponse.data);

    // 2. Sauvegarder la transaction dans Firestore
    await db.collection('transactions').add({
      tontineId,
      cotisationId,
      membreId,
      membreNom,
      telephone,
      montant,
      methode,
      reference: campyResponse.data.reference,
      statut: 'en_attente',
      dateCreation: new Date().toISOString(),
    });

    // 3. Retourner la réponse
    res.json({
      success: true,
      reference: campyResponse.data.reference,
      message: 'Paiement initié. Vérifiez votre téléphone.',
    });
  } catch (error) {
    console.error('❌ Erreur paiement:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// ========================================
// ROUTE 2 : WEBHOOK CAMPY
// ========================================
app.post('/api/webhook/campy', async (req, res) => {
  try {
    console.log('📩 Webhook reçu:', req.body);

    const { reference, status, external_reference } = req.body;

    if (status === 'SUCCESSFUL') {
      const cotisationRef = db
        .collectionGroup('cotisations')
        .where('id', '==', external_reference);

      const snapshot = await cotisationRef.get();

      if (!snapshot.empty) {
        const doc = snapshot.docs[0];
        await doc.ref.update({
          statut: 'payee',
          datePaiement: new Date().toISOString(),
          referencePaiement: reference,
          methode: 'momo',
        });

        console.log('✅ Cotisation mise à jour:', doc.id);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erreur webhook:', error);
    res.status(500).json({ success: false });
  }
});

// ========================================
// ROUTE 3 : VÉRIFIER LE STATUT
// ========================================
app.get('/api/statut/:reference', async (req, res) => {
  try {
    const { reference } = req.params;

    const campyResponse = await axios.get(
      `${CAMPY_BASE_URL}/transaction/${reference}/`,
      {
        headers: {
          'Authorization': `Token ${CAMPY_TOKEN}`,
        },
      }
    );

    res.json({
      success: true,
      statut: campyResponse.data.status,
    });
  } catch (error) {
    console.error('❌ Erreur statut:', error.message);
    res.status(500).json({ success: false });
  }
});

// ========================================
// ROUTE 4 : TEST
// ========================================
app.get('/', (req, res) => {
  res.json({
    message: 'MboaNkap Backend - OK',
    version: '1.0.0',
  });
});

// ========================================
// DÉMARRAGE
// ========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur MboaNkap démarré sur le port ${PORT}`);
});
