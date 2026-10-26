#!/usr/bin/env python3
"""
ARINC839Forge Pro — Automated Unit & Regression Test Suite
10 Comprehensive Verification Tests for ARINC 839 MAGC Engine & Bus Synthesizer
"""

import unittest
from arinc839_cli import ARINC839Simulator

class TestARINC839ForgePro(unittest.TestCase):
    def setUp(self):
        self.sim = ARINC839Simulator()

    def test_01_multi_bearer_initialization(self):
        """Test 01: Multi-Bearer Interface Initialization (5 Physical Bearers)"""
        expected_bearers = {"GATELINK", "VDL_MODE_2", "SATCOM_AERO", "HFDL", "CELLULAR_RAMP"}
        self.assertEqual(set(self.sim.bearers.keys()), expected_bearers)
        for b in self.sim.bearers.values():
            self.assertTrue(b.active)
            self.assertGreater(b.snr, 0)

    def test_02_gate_phase_least_cost(self):
        """Test 02: Gate Operational Phase Least-Cost Routing"""
        self.sim.set_phase("GATE")
        self.assertEqual(self.sim.active_routes["AOC"], "GATELINK")
        self.assertEqual(self.sim.active_routes["AAC"], "GATELINK")
        self.assertEqual(self.sim.bearers["GATELINK"].cost_per_mb, 0.00)

    def test_03_airborne_vdl2_selection(self):
        """Test 03: Airborne Continental Flight Phase VDL Mode 2 Routing"""
        self.sim.set_phase("CRUISE_CONTINENTAL")
        self.assertEqual(self.sim.active_routes["ATS"], "VDL_MODE_2")
        self.assertFalse(self.sim.bearers["GATELINK"].active)

    def test_04_oceanic_satcom_failover(self):
        """Test 04: Trans-Oceanic Flight Phase SATCOM Selection"""
        self.sim.set_phase("CRUISE_OCEANIC")
        self.assertEqual(self.sim.active_routes["ATS"], "SATCOM_AERO")
        self.assertIn(self.sim.active_routes["AOC"], ["SATCOM_AERO", "HFDL"])

    def test_05_ats_preemption(self):
        """Test 05: Air Traffic Services (CPDLC) Priority Preemption"""
        res_aoc = self.sim.send_message("AOC", "NON-URGENT FLIGHT LOG", 500)
        res_ats = self.sim.send_message("ATS", "URGENT CPDLC HOLD INSTRUCTION", 128)
        self.assertEqual(res_ats["status"], "DELIVERED")
        self.assertGreater(self.sim.preemptions, 0)

    def test_06_degraded_link_failover(self):
        """Test 06: Degraded RF Signal SNR Failover"""
        self.sim.set_phase("CRUISE_CONTINENTAL")
        self.assertEqual(self.sim.active_routes["ATS"], "VDL_MODE_2")
        # Degrade VDL Mode 2 SNR below 8 dB
        self.sim.bearers["VDL_MODE_2"].snr = 4
        self.sim.update_bearer_states()
        self.sim.update_routing()
        self.assertEqual(self.sim.active_routes["ATS"], "SATCOM_AERO")

    def test_07_polar_flight_hfdl_availability(self):
        """Test 07: Polar Flight Phase HFDL Long-Range Availability"""
        self.sim.set_phase("CRUISE_POLAR")
        self.assertTrue(self.sim.bearers["HFDL"].active)
        self.assertIn("CRUISE_POLAR", self.sim.bearers["HFDL"].available_phases)

    def test_08_arinc429_label271_parity(self):
        """Test 08: ARINC 429 Label 271 Bit 32 Odd Parity Verification"""
        words = self.sim.generate_arinc429_words()
        word271_int = int(words["label271"], 16)
        bit_count = bin(word271_int).count('1')
        self.assertEqual(bit_count % 2, 1, f"Label 271 parity must be odd (bits: {bit_count})")

    def test_09_arinc429_label272_parity(self):
        """Test 09: ARINC 429 Label 272 Bit 32 Odd Parity Verification"""
        words = self.sim.generate_arinc429_words()
        word272_int = int(words["label272"], 16)
        bit_count = bin(word272_int).count('1')
        self.assertEqual(bit_count % 2, 1, f"Label 272 parity must be odd (bits: {bit_count})")

    def test_10_do358a_latency_compliance(self):
        """Test 10: RTCA DO-358A CPDLC Latency Envelope Compliance (<4000ms)"""
        for phase in ["GATE", "CLIMB", "CRUISE_CONTINENTAL", "CRUISE_OCEANIC"]:
            self.sim.set_phase(phase)
            active_bearer_id = self.sim.active_routes["ATS"]
            active_bearer = self.sim.bearers[active_bearer_id]
            self.assertLessEqual(
                active_bearer.nominal_latency_ms,
                self.sim.traffic_classes["ATS"]["max_lat_ms"],
                f"Latency of bearer {active_bearer_id} ({active_bearer.nominal_latency_ms}ms) exceeded 4000ms limit in {phase}"
            )

if __name__ == "__main__":
    unittest.main()
