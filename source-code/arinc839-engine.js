/**
 * ARINC839Forge Pro — Core Engine
 * Manager of Air-Ground Communications (MAGC) Multi-Bearer Policy Router & Handover Engine
 * Standard References: ARINC Project Paper 839, ARINC 618, ARINC 620, RTCA DO-358A, FAA AC 20-140C
 */

class ARINC839Engine {
  constructor() {
    this.flightPhases = [
      'GATE', 'TAXI_OUT', 'TAKEOFF', 'CLIMB',
      'CRUISE_CONTINENTAL', 'CRUISE_OCEANIC', 'CRUISE_POLAR',
      'DESCENT', 'APPROACH', 'LANDING', 'TAXI_IN'
    ];
    this.currentFlightPhase = 'GATE';

    // Traffic Categories & Priorities (ARINC 839 §3.2)
    this.trafficClasses = {
      ATS: { id: 'ATS', name: 'Air Traffic Services (CPDLC/ADS-C)', priority: 1, maxLatencyMs: 4000, preemption: true },
      AOC: { id: 'AOC', name: 'Airline Operational Control (Flight Plan/Ops)', priority: 2, maxLatencyMs: 15000, preemption: false },
      AAC: { id: 'AAC', name: 'Airline Administrative Comms (Crew/Pax Manifest)', priority: 3, maxLatencyMs: 60000, preemption: false },
      APC: { id: 'APC', name: 'Airline Passenger Comms (IFE/Broadband)', priority: 4, maxLatencyMs: 300000, preemption: false }
    };

    // Multi-Bearer Link Interfaces (ARINC 839 §4.1)
    this.bearers = {
      GATELINK: {
        id: 'GATELINK',
        name: 'Airport Gatelink (ARINC 842 / 802.11ac / 5G)',
        type: 'SURFACE_HIGH_SPEED',
        costPerMB: 0.00,
        bandwidthKbps: 300000,
        nominalLatencyMs: 15,
        availablePhases: ['GATE'],
        status: 'CONNECTED',
        rssi: -58,
        snr: 32,
        active: true
      },
      VDL_MODE_2: {
        id: 'VDL_MODE_2',
        name: 'VHF Digital Link Mode 2 (ARINC 720 / 750)',
        type: 'TERRESTRIAL_LINE_OF_SIGHT',
        costPerMB: 120.00, // ~$0.12 / kB
        bandwidthKbps: 31.5,
        nominalLatencyMs: 350,
        availablePhases: ['GATE', 'TAXI_OUT', 'TAKEOFF', 'CLIMB', 'CRUISE_CONTINENTAL', 'DESCENT', 'APPROACH', 'LANDING', 'TAXI_IN'],
        status: 'CONNECTED',
        rssi: -68,
        snr: 24,
        active: true
      },
      SATCOM_AERO: {
        id: 'SATCOM_AERO',
        name: 'Aeronautical SATCOM (ARINC 781 Inmarsat / Iridium / Starlink)',
        type: 'SATELLITE_CONSTELLATION',
        costPerMB: 4.50,
        bandwidthKbps: 8000,
        nominalLatencyMs: 750,
        availablePhases: ['CLIMB', 'CRUISE_CONTINENTAL', 'CRUISE_OCEANIC', 'CRUISE_POLAR', 'DESCENT'],
        status: 'STANDBY',
        rssi: -72,
        snr: 19,
        active: true
      },
      HFDL: {
        id: 'HFDL',
        name: 'High Frequency Data Link (ARINC 753)',
        type: 'LONG_RANGE_IONOSPHERIC',
        costPerMB: 1800.00, // ~$1.80 / kB
        bandwidthKbps: 1.8,
        nominalLatencyMs: 2500,
        availablePhases: ['CRUISE_OCEANIC', 'CRUISE_POLAR'],
        status: 'STANDBY',
        rssi: -82,
        snr: 12,
        active: true
      },
      CELLULAR_RAMP: {
        id: 'CELLULAR_RAMP',
        name: 'Cellular Surface Link (ARINC 760 / 4G-5G)',
        type: 'GROUND_CELLULAR',
        costPerMB: 0.05,
        bandwidthKbps: 50000,
        nominalLatencyMs: 40,
        availablePhases: ['GATE', 'TAXI_OUT', 'TAXI_IN'],
        status: 'STANDBY',
        rssi: -65,
        snr: 26,
        active: true
      }
    };

    // Routing Policy Configuration (ARINC 839 §5.2)
    this.policyMode = 'LEAST_COST_SAFETY_FIRST'; // Modes: LEAST_COST_SAFETY_FIRST, MIN_LATENCY, MAXIMUM_REDUNDANCY
    this.handoverHysteresisSec = 5.0; // 5-second hysteresis dampener to prevent flapping
    this.lastHandoverTimestamp = Date.now() - 10000;
    this.activeRoutes = {
      ATS: 'GATELINK',
      AOC: 'GATELINK',
      AAC: 'GATELINK',
      APC: 'GATELINK'
    };

    // Message Queues
    this.queues = {
      ATS: [],
      AOC: [],
      AAC: [],
      APC: []
    };

    // Telemetry Statistics
    this.stats = {
      messagesRouted: 0,
      handoversCompleted: 0,
      totalBytesTransferred: 0,
      preemptionsExecuted: 0,
      droppedPackets: 0
    };
  }

  setFlightPhase(phase) {
    if (!this.flightPhases.includes(phase)) {
      throw new Error(`Invalid flight phase: ${phase}`);
    }
    this.currentFlightPhase = phase;
    this.evaluateBearerAvailability();
    this.recomputeRoutingTable();
    return this.getRoutingSummary();
  }

  setBearerStatus(bearerId, status, rssi = null, snr = null) {
    const b = this.bearers[bearerId];
    if (!b) throw new Error(`Unknown bearer: ${bearerId}`);
    b.status = status;
    if (rssi !== null) b.rssi = rssi;
    if (snr !== null) b.snr = snr;
    b.active = (status === 'CONNECTED' || status === 'STANDBY') && (b.snr > 8);
    this.recomputeRoutingTable();
  }

  evaluateBearerAvailability() {
    for (const [id, b] of Object.entries(this.bearers)) {
      const allowedInPhase = b.availablePhases.includes(this.currentFlightPhase);
      if (!allowedInPhase) {
        b.status = 'INHIBITED';
        b.active = false;
      } else if (b.status === 'INHIBITED') {
        b.status = 'STANDBY';
        b.active = true;
      }
    }
  }

  recomputeRoutingTable() {
    const candidates = Object.values(this.bearers).filter(b => b.active && b.status !== 'INHIBITED');

    for (const trafficClass of Object.keys(this.trafficClasses)) {
      let selected = null;

      if (trafficClass === 'ATS') {
        // ATS (CPDLC): Must prioritize reliability and lowest latency over cost
        // Preference on ground: GATELINK -> VDL_MODE_2
        // Preference in continental: VDL_MODE_2 -> SATCOM_AERO
        // Preference oceanic/polar: SATCOM_AERO -> HFDL
        selected = candidates
          .filter(b => b.nominalLatencyMs <= this.trafficClasses.ATS.maxLatencyMs)
          .sort((a, b) => {
            // Favor lowest latency for ATS
            return a.nominalLatencyMs - b.nominalLatencyMs;
          })[0];
      } else {
        // AOC / AAC / APC: Least cost routing principle
        selected = candidates.sort((a, b) => a.costPerMB - b.costPerMB)[0];
      }

      const currentBearer = this.activeRoutes[trafficClass];
      if (selected && selected.id !== currentBearer) {
        const elapsedSec = (Date.now() - this.lastHandoverTimestamp) / 1000;
        if (elapsedSec >= this.handoverHysteresisSec || !this.bearers[currentBearer] || !this.bearers[currentBearer].active) {
          this.activeRoutes[trafficClass] = selected.id;
          this.lastHandoverTimestamp = Date.now();
          this.stats.handoversCompleted++;
        }
      } else if (!selected) {
        this.activeRoutes[trafficClass] = 'NO_LINK_AVAILABLE';
      }
    }
  }

  enqueueMessage(trafficClass, messagePayload, sizeBytes) {
    if (!this.trafficClasses[trafficClass]) {
      throw new Error(`Invalid traffic class: ${trafficClass}`);
    }

    const msg = {
      id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      trafficClass: trafficClass,
      payload: messagePayload,
      sizeBytes: sizeBytes,
      enqueuedAt: Date.now(),
      priority: this.trafficClasses[trafficClass].priority
    };

    // Check preemption
    if (this.trafficClasses[trafficClass].preemption) {
      this.queues[trafficClass].unshift(msg);
      this.stats.preemptionsExecuted++;
    } else {
      this.queues[trafficClass].push(msg);
    }

    this.stats.messagesRouted++;
    this.stats.totalBytesTransferred += sizeBytes;
    return msg;
  }

  dispatchNextMessage() {
    // Priority order: ATS -> AOC -> AAC -> APC
    for (const prio of ['ATS', 'AOC', 'AAC', 'APC']) {
      if (this.queues[prio].length > 0) {
        const msg = this.queues[prio].shift();
        const bearerId = this.activeRoutes[prio];
        return {
          status: bearerId !== 'NO_LINK_AVAILABLE' ? 'DISPATCHED' : 'DROPPED_NO_LINK',
          message: msg,
          bearer: bearerId,
          latencyMs: this.bearers[bearerId] ? this.bearers[bearerId].nominalLatencyMs : 0
        };
      }
    }
    return { status: 'QUEUE_EMPTY' };
  }

  generateARINC429BusWords() {
    // ARINC 429 Label 271 (Octal): MAGC Multi-Link Status & Selected Bearers
    // Label 271 octal = 0271 = 0xB9 in inverted ARINC 429 bit order (0x271 -> binary 10 0111 0001 -> rev: 1000 1110 = 0x8E or octal 271)
    const label271 = 0xB9; // Label 271 representation
    let data271 = 0;

    // Bearer encoding bits:
    // 0: NONE, 1: GATELINK, 2: VDL2, 3: SATCOM, 4: HFDL, 5: CELLULAR
    const bearerMap = { GATELINK: 1, VDL_MODE_2: 2, SATCOM_AERO: 3, HFDL: 4, CELLULAR_RAMP: 5 };
    const atsBearerVal = bearerMap[this.activeRoutes.ATS] || 0;
    const aocBearerVal = bearerMap[this.activeRoutes.AOC] || 0;

    data271 |= (atsBearerVal & 0x07) << 10; // Bits 11-13 ATS
    data271 |= (aocBearerVal & 0x07) << 13; // Bits 14-16 AOC
    data271 |= (this.bearers.GATELINK.active ? 1 : 0) << 16; // Bit 17 Gatelink active
    data271 |= (this.bearers.VDL_MODE_2.active ? 1 : 0) << 17; // Bit 18 VDL2 active
    data271 |= (this.bearers.SATCOM_AERO.active ? 1 : 0) << 18; // Bit 19 SATCOM active
    data271 |= (this.bearers.HFDL.active ? 1 : 0) << 19; // Bit 20 HFDL active
    data271 |= 0x03 << 28; // Bits 29-30 SSM (Normal Operation: 11b)

    let word271 = (data271 & 0x7FFFFF00) | (label271 & 0xFF);
    word271 = this.applyOddParity(word271);

    // Label 272 (Octal): Link Quality & Queue Depth
    const label272 = 0xBA; // Label 272 octal representation
    let data272 = 0;
    const totalQueueDepth = Object.values(this.queues).reduce((sum, q) => sum + q.length, 0);
    const activeATS = this.bearers[this.activeRoutes.ATS];
    const snrVal = activeATS ? Math.min(63, Math.max(0, activeATS.snr)) : 0;

    data272 |= (totalQueueDepth & 0x3F) << 10; // Bits 11-16 Queue depth
    data272 |= (snrVal & 0x3F) << 16; // Bits 17-22 SNR margin dB
    data272 |= (this.stats.handoversCompleted & 0x1F) << 22; // Bits 23-27 Handover count
    data272 |= 0x03 << 28; // Bits 29-30 SSM (Normal Operation)

    let word272 = (data272 & 0x7FFFFF00) | (label272 & 0xFF);
    word272 = this.applyOddParity(word272);

    return {
      label271: { hex: '0x' + (word271 >>> 0).toString(16).toUpperCase().padStart(8, '0'), parityValid: this.verifyOddParity(word271) },
      label272: { hex: '0x' + (word272 >>> 0).toString(16).toUpperCase().padStart(8, '0'), parityValid: this.verifyOddParity(word272) }
    };
  }

  applyOddParity(word32) {
    let bits = word32 & 0x7FFFFFFF;
    let count = 0;
    for (let i = 0; i < 31; i++) {
      if ((bits >> i) & 1) count++;
    }
    if (count % 2 === 0) {
      bits |= (1 << 31); // Add parity bit at bit 32
    }
    return bits >>> 0;
  }

  verifyOddParity(word32) {
    let count = 0;
    for (let i = 0; i < 32; i++) {
      if ((word32 >>> i) & 1) count++;
    }
    return count % 2 === 1;
  }

  getRoutingSummary() {
    return {
      flightPhase: this.currentFlightPhase,
      policyMode: this.policyMode,
      activeRoutes: { ...this.activeRoutes },
      stats: { ...this.stats },
      busWords: this.generateARINC429BusWords()
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ARINC839Engine };
}
