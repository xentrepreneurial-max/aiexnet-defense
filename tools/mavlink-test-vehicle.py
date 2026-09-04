#!/usr/bin/env python3
"""
MAVLink test vehicle — a loopback target for verifying the ground station.

WHAT THIS IS
  A real MAVLink v2 endpoint built on pymavlink, the reference implementation.
  It speaks the genuine protocol: heartbeats, telemetry streams, the mission
  upload handshake, and command acknowledgements. Point the console's link at
  it and every part of the ground-station side is exercised for real.

WHAT THIS IS NOT
  A flight dynamics model. The airframe here is a point mass that turns toward
  the active waypoint and moves at a fixed cruise speed. It is a TEST DOUBLE
  for the ground station, not a simulator of how an aircraft actually flies,
  and nothing it produces should ever be read as operational data.

  For real flight behaviour use ArduPilot SITL, which runs the actual firmware:
      sim_vehicle.py -v ArduPlane --out=udp:127.0.0.1:14550

USAGE
  python3 -m venv .venv && .venv/bin/pip install pymavlink
  .venv/bin/python tools/mavlink-test-vehicle.py --gcs 127.0.0.1:14550

  Then in the console: connect the link on UDP 14550, upload a mission,
  set AUTO, arm, and start the mission.
"""

import argparse
import math
import socket
import time

from pymavlink.dialects.v20 import ardupilotmega as mavlink

EARTH_R = 6371000.0

# ArduPlane custom mode numbers.
PLANE_MODES = {
    0: "MANUAL", 2: "STABILIZE", 5: "FBWA", 10: "AUTO",
    11: "RTL", 12: "LOITER", 13: "TAKEOFF", 15: "GUIDED",
}


def haversine_m(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(a)))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def project(lat, lon, bearing, distance_m):
    ang = distance_m / EARTH_R
    br = math.radians(bearing)
    p1 = math.radians(lat)
    l1 = math.radians(lon)
    p2 = math.asin(math.sin(p1) * math.cos(ang) + math.cos(p1) * math.sin(ang) * math.cos(br))
    l2 = l1 + math.atan2(
        math.sin(br) * math.sin(ang) * math.cos(p1),
        math.cos(ang) - math.sin(p1) * math.sin(p2),
    )
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


class Sink:
    """Collects bytes pymavlink writes so we can send them ourselves."""

    def __init__(self):
        self.buf = b""

    def write(self, data):
        self.buf += data


class TestVehicle:
    def __init__(self, gcs_host, gcs_port, home_lat, home_lon, cruise_ms, sysid):
        self.gcs = (gcs_host, gcs_port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("0.0.0.0", 0))
        self.sock.settimeout(0.02)

        self.sink = Sink()
        self.mav = mavlink.MAVLink(self.sink, srcSystem=sysid, srcComponent=1)
        self.parser = mavlink.MAVLink(Sink(), srcSystem=sysid, srcComponent=1)
        self.parser.robust_parsing = True

        self.home = (home_lat, home_lon)
        self.lat, self.lon = home_lat, home_lon
        self.alt_rel = 0.0
        self.heading = 0.0
        self.cruise = cruise_ms
        self.armed = False
        self.custom_mode = 0
        self.boot = time.time()
        self.battery = 100.0

        self.mission = []
        self.pending_count = 0
        self.next_request = 0
        self.current_wp = 0
        self.mission_running = False

    # -- transmit helpers ---------------------------------------------------

    def send(self, msg):
        self.sink.buf = b""
        self.mav.send(msg)
        self.sock.sendto(self.sink.buf, self.gcs)

    def statustext(self, severity, text):
        self.send(mavlink.MAVLink_statustext_message(
            severity=severity, text=text.encode()[:50], id=0, chunk_seq=0))

    # -- telemetry ----------------------------------------------------------

    def send_telemetry(self):
        boot_ms = int((time.time() - self.boot) * 1000)
        base_mode = 1 | (128 if self.armed else 0)

        self.send(mavlink.MAVLink_heartbeat_message(
            type=1, autopilot=3, base_mode=base_mode,
            custom_mode=self.custom_mode, system_status=4, mavlink_version=3))

        vx = int(self.cruise * math.cos(math.radians(self.heading)) * 100) if self.armed else 0
        vy = int(self.cruise * math.sin(math.radians(self.heading)) * 100) if self.armed else 0

        self.send(mavlink.MAVLink_global_position_int_message(
            time_boot_ms=boot_ms,
            lat=int(self.lat * 1e7), lon=int(self.lon * 1e7),
            alt=int(self.alt_rel * 1000), relative_alt=int(self.alt_rel * 1000),
            vx=vx, vy=vy, vz=0, hdg=int(self.heading * 100)))

        self.send(mavlink.MAVLink_sys_status_message(
            onboard_control_sensors_present=1467,
            onboard_control_sensors_enabled=1263,
            onboard_control_sensors_health=1467,
            load=350, voltage_battery=int(50000 * self.battery / 100),
            current_battery=1200, battery_remaining=int(self.battery),
            drop_rate_comm=0, errors_comm=0,
            errors_count1=0, errors_count2=0, errors_count3=0, errors_count4=0))

        self.send(mavlink.MAVLink_gps_raw_int_message(
            time_usec=int(time.time() * 1e6), fix_type=6,
            lat=int(self.lat * 1e7), lon=int(self.lon * 1e7),
            alt=int(self.alt_rel * 1000), eph=90, epv=120,
            vel=int(self.cruise * 100) if self.armed else 0,
            cog=int(self.heading * 100), satellites_visible=21,
            alt_ellipsoid=0, h_acc=0, v_acc=0, vel_acc=0, hdg_acc=0, yaw=0))

        self.send(mavlink.MAVLink_home_position_message(
            latitude=int(self.home[0] * 1e7), longitude=int(self.home[1] * 1e7),
            altitude=0, x=0, y=0, z=0, q=[1, 0, 0, 0],
            approach_x=0, approach_y=0, approach_z=0, time_usec=0))

        self.send(mavlink.MAVLink_mission_current_message(
            seq=self.current_wp, total=len(self.mission),
            mission_state=2 if self.mission_running else 1, mission_mode=0))

    # -- inbound ------------------------------------------------------------

    def handle(self, msg):
        t = msg.get_type()

        if t == "MISSION_COUNT":
            self.pending_count = msg.count
            self.mission = [None] * msg.count
            self.next_request = 0
            print(f"  <- MISSION_COUNT {msg.count}")
            self.request_next()

        elif t in ("MISSION_ITEM_INT", "MISSION_ITEM"):
            seq = msg.seq
            if seq < len(self.mission):
                self.mission[seq] = msg
                print(f"  <- MISSION_ITEM_INT seq={seq} cmd={msg.command} "
                      f"lat={msg.x / 1e7:.5f} lon={msg.y / 1e7:.5f} alt={msg.z:.0f}")
            self.next_request = seq + 1
            if self.next_request >= self.pending_count:
                self.send(mavlink.MAVLink_mission_ack_message(
                    target_system=255, target_component=190, type=0, mission_type=0))
                print(f"  -> MISSION_ACK accepted ({self.pending_count} items)")
                self.current_wp = 0
                self.statustext(6, "Mission received")
            else:
                self.request_next()

        elif t == "COMMAND_LONG":
            self.handle_command_long(msg)

        elif t == "COMMAND_INT":
            if msg.command == 192:  # MAV_CMD_DO_REPOSITION
                target = (msg.x / 1e7, msg.y / 1e7, msg.z)
                self.mission = [None]
                self.reposition_target = target
                self.custom_mode = 15  # GUIDED
                self.ack(msg.command, 0)
                print(f"  <- DO_REPOSITION {target[0]:.5f},{target[1]:.5f} @ {target[2]:.0f} m")
            else:
                self.ack(msg.command, 3)

    def handle_command_long(self, msg):
        cmd = msg.command
        if cmd == 400:  # COMPONENT_ARM_DISARM
            want = msg.param1 > 0.5
            self.armed = want
            self.ack(cmd, 0)
            self.statustext(6, "Armed" if want else "Disarmed")
            print(f"  <- ARM_DISARM -> {'ARMED' if want else 'DISARMED'}")
        elif cmd == 176:  # DO_SET_MODE
            self.custom_mode = int(msg.param2)
            self.ack(cmd, 0)
            name = PLANE_MODES.get(self.custom_mode, str(self.custom_mode))
            self.statustext(6, f"Mode {name}")
            print(f"  <- DO_SET_MODE -> {name}")
        elif cmd == 300:  # MISSION_START
            if not self.mission or self.mission[0] is None:
                self.ack(cmd, 4)  # MAV_RESULT_FAILED
                self.statustext(4, "No mission loaded")
                return
            self.mission_running = True
            self.current_wp = 0
            self.ack(cmd, 0)
            print("  <- MISSION_START -> running")
        elif cmd == 20:  # NAV_RETURN_TO_LAUNCH
            self.custom_mode = 11
            self.mission_running = False
            self.rtl = True
            self.ack(cmd, 0)
            self.statustext(6, "RTL engaged")
            print("  <- RTL")
        else:
            self.ack(cmd, 3)  # MAV_RESULT_UNSUPPORTED

    def ack(self, command, result):
        self.send(mavlink.MAVLink_command_ack_message(
            command=command, result=result, progress=0, result_param2=0,
            target_system=255, target_component=190))

    def request_next(self):
        self.send(mavlink.MAVLink_mission_request_int_message(
            target_system=255, target_component=190,
            seq=self.next_request, mission_type=0))

    # -- movement -----------------------------------------------------------

    def step(self, dt):
        """Point-mass navigation. Not a flight model — see the module docstring."""
        if not self.armed:
            return

        target = None
        if getattr(self, "rtl", False):
            target = (self.home[0], self.home[1], self.alt_rel)
        elif hasattr(self, "reposition_target"):
            target = self.reposition_target
        elif self.mission_running and self.current_wp < len(self.mission):
            item = self.mission[self.current_wp]
            if item is None:
                return
            if item.command == 20:  # RTL waypoint
                target = (self.home[0], self.home[1], self.alt_rel)
            else:
                target = (item.x / 1e7, item.y / 1e7, item.z)

        if target is None:
            return

        tlat, tlon, talt = target
        dist = haversine_m(self.lat, self.lon, tlat, tlon)

        # Climb toward the commanded altitude at a fixed rate.
        if abs(talt - self.alt_rel) > 0.5:
            self.alt_rel += math.copysign(min(5.0 * dt, abs(talt - self.alt_rel)), talt - self.alt_rel)

        acceptance = 150.0
        if dist < acceptance:
            if self.mission_running and self.current_wp < len(self.mission) - 1:
                self.current_wp += 1
                self.statustext(6, f"Reached waypoint {self.current_wp}")
                print(f"  ** reached waypoint {self.current_wp - 1}")
            elif self.mission_running:
                self.mission_running = False
                self.statustext(6, "Mission complete")
                print("  ** mission complete")
            return

        self.heading = bearing_deg(self.lat, self.lon, tlat, tlon)
        self.lat, self.lon = project(self.lat, self.lon, self.heading, self.cruise * dt)
        self.battery = max(0.0, self.battery - dt * 0.02)

    # -- main loop ----------------------------------------------------------

    def run(self):
        print(f"MAVLink TEST VEHICLE -> {self.gcs[0]}:{self.gcs[1]}")
        print(f"  home {self.home[0]:.5f}, {self.home[1]:.5f}   cruise {self.cruise} m/s")
        print("  This is a protocol test double, not a flight model.\n")

        last = time.time()
        last_tel = 0.0
        while True:
            now = time.time()
            dt = now - last
            last = now

            try:
                data, _ = self.sock.recvfrom(4096)
                for msg in self.parser.parse_buffer(data) or []:
                    if msg.get_type() != "BAD_DATA":
                        self.handle(msg)
            except socket.timeout:
                pass
            except Exception as exc:  # noqa: BLE001 - keep the harness alive
                print("  parse error:", exc)

            self.step(dt)

            if now - last_tel >= 0.25:
                last_tel = now
                self.send_telemetry()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--gcs", default="127.0.0.1:14550",
                    help="ground station host:port to send telemetry to")
    ap.add_argument("--home", default="21.4520,91.9639",
                    help="home position lat,lon (default: BAF Cox's Bazar)")
    ap.add_argument("--cruise", type=float, default=33.0, help="cruise speed m/s")
    ap.add_argument("--sysid", type=int, default=1, help="vehicle system id")
    args = ap.parse_args()

    host, port = args.gcs.split(":")
    hlat, hlon = (float(v) for v in args.home.split(","))
    TestVehicle(host, int(port), hlat, hlon, args.cruise, args.sysid).run()


if __name__ == "__main__":
    main()
