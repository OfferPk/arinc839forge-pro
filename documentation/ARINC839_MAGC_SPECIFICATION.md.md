# ARINC Project Paper 839 Manager of Air-Ground Communications (MAGC) Technical Specification

**Document ID**: ARINC839-SPEC-2026-v1.0  
**Normative Standards**: ARINC Project Paper 839, ARINC 618, ARINC 620, RTCA DO-358A, RTCA DO-219, FAA AC 20-140C, ICAO Annex 10 Vol III  
**Classification**: Commercial Avionics Multi-Link Router & Flight Communications Technical Standard

---

## 1\. Executive Summary & Operational Scope

The **ARINC Project Paper 839 (Manager of Air-Ground Communications \- MAGC)** specifies the avionics architecture, routing policies, handover algorithms, and cockpit bus interfaces for arbitrating commercial aircraft data communication across multiple heterogeneous physical air-ground links:

1. **Airport Gatelink (ARINC 842\)**: 802.11ac / 5G / Optical stanchion; \$0.00/MB; up to 300+ Mbps; active during GATE phase only.  
2. **VHF Digital Link Mode 2 (ARINC 720 / 750\)**: Line-of-sight VHF; \~\$120/MB (\$0.12/kB); 31.5 kbps; primary over continental airspace.  
3. **Aeronautical SATCOM (ARINC 781 / 741\)**: Inmarsat SBB / Iridium Certus / GEO / LEO; \$4.50/MB; 8.0 Mbps; primary over oceanic & remote routes.  
4. **High Frequency Data Link (ARINC 753\)**: Polar ionospheric refraction; \~\$1800/MB; 1.8 kbps; extreme polar latitudes.  
5. **Cellular Surface Link (ARINC 760\)**: Airport ramp 4G/5G; \$0.05/MB; 50 Mbps; ramp taxi operations.

---

## 2\. Traffic Classification & Priority Preemption

ARINC 839 establishes four distinct traffic classes with strict Quality of Service (QoS) guarantees:

- **Class A \- Air Traffic Services (ATS)**: Controller-Pilot Data Link Communications (CPDLC) and Automatic Dependent Surveillance \- Contract (ADS-C). Assigned **Priority 1** with unconditional queue preemption and maximum one-way transfer delay envelope under 4,000 ms (RTCA DO-358A).  
- **Class B \- Airline Operational Control (AOC)**: Operational flight plans (OFP), weather reports, fuel status, engine health monitoring. Assigned **Priority 2** with Least-Cost Routing (LCR) preference.  
- **Class C \- Airline Administrative Communications (AAC)**: Cabin crew scheduling, passenger manifests, catering updates. Assigned **Priority 3**.  
- **Class D \- Airline Passenger Communications (APC)**: In-flight entertainment (IFE) broadband and passenger Wi-Fi. Assigned **Priority 4** and strictly isolated to PIESD networks.

---

## 3\. Dynamic Least-Cost Routing & Handover Hysteresis

To prevent link oscillation ("flapping") when operating along coverage boundaries (e.g., VHF line-of-sight cutoff or airport gate pullout), ARINC 839 enforces:

1. **Handover Hysteresis Window**: A mandatory dampener of 5.0 seconds prevents bearer migration unless link quality drops below threshold for the full duration or the current bearer is completely lost.  
2. **Link Degradation Failover**: When Signal-to-Noise Ratio (SNR) drops below 8.0 dB or Bit Error Rate (BER) exceeds 10^-3, the MAGC router automatically triggers seamless migration to the hot-standby bearer.  
3. **Lossless Session State**: Active TCP/IP and ATN/OSI dialogues preserve sequence numbers and packet buffers across physical handovers.

---

## 4\. ARINC 429 Glass-Cockpit Discrete Bus Output

The MAGC LRU reports status onto the low-speed aircraft ARINC 429 digital bus:

- **Label 271 (Octal)**: Multi-Link Status & Selected Bearers  
  - Bits 11-13: Active ATS Bearer (0: None, 1: Gatelink, 2: VDL2, 3: SATCOM, 4: HFDL, 5: Cellular)  
  - Bits 14-16: Active AOC Bearer  
  - Bits 17-20: Bearer Health Bits (Gatelink, VDL2, SATCOM, HFDL)  
  - Bits 29-30: SSM (Sign/Status Matrix: 11b Normal Operation)  
  - Bit 32: Odd Parity  
- **Label 272 (Octal)**: Active Link SNR Margin & Handover Counter  
  - Bits 11-16: Total Queue Depth  
  - Bits 17-22: Active Primary Link SNR (dB)  
  - Bits 23-27: Total Handover Counter  
  - Bits 29-30: SSM  
  - Bit 32: Odd Parity