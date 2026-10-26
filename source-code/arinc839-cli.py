#!/usr/bin/env python3
"""
ARINC839Forge Pro — Standalone Python 3 CLI Runner & Simulation Suite
Manager of Air-Ground Communications (MAGC) Multi-Bearer Policy Router
Standards: ARINC Project Paper 839, RTCA DO-358A, FAA AC 20-140C
"""

import sys
import json
import time

class Bearer:
    def __init__(self, bearer_id, name, cost_per_mb, bandwidth_kbps, latency_ms, phases):
        self.id = bearer_id
        self.name = name
        self.cost_per_mb = cost_per_mb
        self.bandwidth_kbps = bandwidth_kbps
        self.nominal_latency_ms = latency_ms
        self.available_phases = phases
        self.status = "STANDBY"
        self.active = True
        self.rssi = -65
        self.snr = 25

class ARINC839Simulator:
    def __init__(self):
        self.flight_phases = [
            "GATE", "TAXI_OUT", "TAKEOFF", "CLIMB",
            "CRUISE_CONTINENTAL", "CRUISE_OCEANIC", "CRUISE_POLAR",
            "DESCENT", "APPROACH", "LANDING", "TAXI_IN"
        ]
        self.current_phase = "GATE"
        
        self.traffic_classes = {
            "ATS": {"name": "Air Traffic Services (CPDLC/ADS-C)", "priority": 1, "max_lat_ms": 4000, "preemption": True},
            "AOC": {"name": "Airline Operational Control", "priority": 2, "max_lat_ms": 15000, "preemption": False},
            "AAC": {"name": "Airline Administrative Comms", "priority": 3, "max_lat_ms": 60000, "preemption": False},
            "APC": {"name": "Airline Passenger Comms", "priority": 4, "max_lat_ms": 300000, "preemption": False}
        }

        self.bearers = {
            "GATELINK": Bearer("GATELINK", "Airport Gatelink (802.11ac/5G)", 0.00, 300000, 15, ["GATE"]),
            "VDL_MODE_2": Bearer("VDL_MODE_2", "VHF Digital Link Mode 2", 120.00, 31.5, 350, [
                "GATE", "TAXI_OUT", "TAKEOFF", "CLIMB", "CRUISE_CONTINENTAL", "DESCENT", "APPROACH", "LANDING", "TAXI_IN"
            ]),
            "SATCOM_AERO": Bearer("SATCOM_AERO", "Aeronautical SATCOM", 4.50, 8000, 750, [
                "CLIMB", "CRUISE_CONTINENTAL", "CRUISE_OCEANIC", "CRUISE_POLAR", "DESCENT"
            ]),
            "HFDL": Bearer("HFDL", "High Frequency Data Link", 1800.00, 1.8, 2500, ["CRUISE_OCEANIC", "CRUISE_POLAR"]),
            "CELLULAR_RAMP": Bearer("CELLULAR_RAMP", "Cellular Surface Link", 0.05, 50000, 40, ["GATE", "TAXI_OUT", "TAXI_IN"])
        }

        self.active_routes = {tc: "GATELINK" for tc in self.traffic_classes}
        self.handovers = 0
        self.messages_routed = 0
        self.preemptions = 0
        self.update_routing()

    def set_phase(self, phase):
        if phase not in self.flight_phases:
            raise ValueError(f"Unknown flight phase: {phase}")
        self.current_phase = phase
        self.update_bearer_states()
        self.update_routing()

    def update_bearer_states(self):
        for b in self.bearers.values():
            if self.current_phase in b.available_phases:
                if b.status == "INHIBITED":
                    b.status = "STANDBY"
                b.active = (b.snr > 8)
            else:
                b.status = "INHIBITED"
                b.active = False

    def update_routing(self):
        candidates = [b for b in self.bearers.values() if b.active and b.status != "INHIBITED"]
        for tc, meta in self.traffic_classes.items():
            if tc == "ATS":
                # Prioritize latency and reliability
                valid = [b for b in candidates if b.nominal_latency_ms <= meta["max_lat_ms"]]
                valid.sort(key=lambda x: x.nominal_latency_ms)
                selected = valid[0] if valid else None
            else:
                # Least cost
                candidates.sort(key=lambda x: x.cost_per_mb)
                selected = candidates[0] if candidates else None

            sel_id = selected.id if selected else "NO_LINK"
            if self.active_routes[tc] != sel_id:
                self.active_routes[tc] = sel_id
                self.handovers += 1

    def send_message(self, traffic_class, payload_str, size_bytes):
        self.messages_routed += 1
        if self.traffic_classes[traffic_class]["preemption"]:
            self.preemptions += 1
        return {
            "traffic_class": traffic_class,
            "route": self.active_routes[traffic_class],
            "size": size_bytes,
            "status": "DELIVERED" if self.active_routes[traffic_class] != "NO_LINK" else "QUEUED"
        }

    def generate_arinc429_words(self):
        # Label 271 (Octal): MAGC Status
        label271 = 0xB9
        bearer_map = {"GATELINK": 1, "VDL_MODE_2": 2, "SATCOM_AERO": 3, "HFDL": 4, "CELLULAR_RAMP": 5}
        ats_val = bearer_map.get(self.active_routes["ATS"], 0)
        aoc_val = bearer_map.get(self.active_routes["AOC"], 0)

        data271 = ((ats_val & 0x07) << 10) | ((aoc_val & 0x07) << 13) | (0x03 << 28)
        word271 = (data271 & 0x7FFFFF00) | label271
        word271 = self.apply_odd_parity(word271)

        # Label 272 (Octal): Link Quality
        label272 = 0xBA
        active_b = self.bearers.get(self.active_routes["ATS"])
        snr = active_b.snr if active_b else 0
        data272 = ((snr & 0x3F) << 16) | ((self.handovers & 0x1F) << 22) | (0x03 << 28)
        word272 = (data272 & 0x7FFFFF00) | label272
        word272 = self.apply_odd_parity(word272)

        return {
            "label271": hex(word271),
            "label272": hex(word272),
            "odd_parity_valid": self.verify_odd_parity(word271) and self.verify_odd_parity(word272)
        }

    def apply_odd_parity(self, word):
        bits = word & 0x7FFFFFFF
        count = bin(bits).count('1')
        if count % 2 == 0:
            bits |= (1 << 31)
        return bits

    def verify_odd_parity(self, word):
        return bin(word).count('1') % 2 == 1

def run_simulation():
    sim = ARINC839Simulator()
    print("=" * 70)
    print("ARINC839Forge Pro — Manager of Air-Ground Communications (MAGC) CLI")
    print("Standard Compliance: ARINC Project Paper 839, RTCA DO-358A, FAA AC 20-140C")
    print("=" * 70)

    phases = ["GATE", "TAXI_OUT", "CLIMB", "CRUISE_CONTINENTAL", "CRUISE_OCEANIC", "DESCENT", "GATE"]
    for p in phases:
        sim.set_phase(p)
        print(f"\n[FLIGHT PHASE: {p}]")
        print(f"  Active ATS Route   : {sim.active_routes['ATS']} (Bearer Latency: {sim.bearers.get(sim.active_routes['ATS'], Bearer('','',0,0,0,[])).nominal_latency_ms}ms)")
        print(f"  Active AOC Route   : {sim.active_routes['AOC']} (Cost: ${sim.bearers.get(sim.active_routes['AOC'], Bearer('','',0,0,0,[])).cost_per_mb:.2f}/MB)")
        
        # Dispatch simulated messages
        ats_msg = sim.send_message("ATS", "CPDLC CLR CLIMB FL370", 256)
        aoc_msg = sim.send_message("AOC", "OFP LOADED FUEL 42.5T", 2048)
        print(f"  Routed ATS Message : {ats_msg['route']} (Preemptive)")
        print(f"  Routed AOC Message : {aoc_msg['route']}")

    bus_words = sim.generate_arinc429_words()
    print("\n" + "-" * 70)
    print("ARINC 429 Glass-Cockpit Discrete Bus Output:")
    print(f"  Label 271 (MAGC Status)      : {bus_words['label271']}")
    print(f"  Label 272 (Link SNR & Quality): {bus_words['label272']}")
    print(f"  Bit 32 Odd Parity Status     : {'VALID (PASS)' if bus_words['odd_parity_valid'] else 'INVALID (FAIL)'}")
    print(f"  Total Handovers Executed     : {sim.handovers}")
    print(f"  Total Messages Dispatched    : {sim.messages_routed}")
    print("=" * 70)

if __name__ == "__main__":
    run_simulation()
