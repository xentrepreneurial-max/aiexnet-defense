# AIEXNET Defense | Bengal-Eye C4ISR Command Matrix

> **Sovereign Military AI, Aerospace Situational Awareness & Multi-Domain Reconnaissance Platform**

## Overview
AIEXNET Defense is an autonomous C4ISR (Command, Control, Communications, Computers, Intelligence, Surveillance, and Reconnaissance) dashboard integrating:
- **Aerospace Radar (ADS-B)**: Live military and commercial flights over Bangladesh and South Asia.
- **Maritime Surveillance (AIS)**: Naval vessel and submarine tracking across the Bay of Bengal.
- **Orbital Reconnaissance (CelesTrak / TLE)**: Live satellite orbit propagation for Bangabandhu-1, Copernicus Sentinel-2 (Optical), Sentinel-1 (SAR Radar), and ISS.
- **National Defense Grid**: Bangladesh Air Force Bases, Naval HQs, 3D AESA early-warning radar rings, SAM envelopes, ADIZ & EEZ boundaries.
- **NASA FIRMS Thermal Anomalies**: Border hotspot detection.
- **AI Defense Intel Copilot**: Real-time tactical query evaluation in Bengali and English.

## Local Development
```bash
npm install
npm run dev
# Opens at http://localhost:3005
```

## Easypanel Deployment
1. Connect this repository to Easypanel.
2. Set Domain to `defense.aiexnet.com`.
3. Set Port to `3000`.
4. Deploy with Dockerfile.
