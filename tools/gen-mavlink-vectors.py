"""Emit reference MAVLink v2 frames from pymavlink for codec verification.

pymavlink is the reference implementation. Any disagreement between it and our
TypeScript codec is our bug, so these vectors are the ground truth the codec
is tested against.
"""
import json
import sys
from pymavlink.dialects.v20 import ardupilotmega as M


class Sink:
    def __init__(self):
        self.buf = b""

    def write(self, data):
        self.buf += data


sink = Sink()
mav = M.MAVLink(sink, srcSystem=255, srcComponent=190)
mav.robust_parsing = True

cases = []


def emit(name, msg, fields):
    sink.buf = b""
    mav.send(msg)
    cases.append({"name": name, "hex": sink.buf.hex(), "fields": fields})


emit("HEARTBEAT",
     M.MAVLink_heartbeat_message(type=2, autopilot=3, base_mode=81,
                                 custom_mode=4, system_status=4,
                                 mavlink_version=3),
     {"type": 2, "autopilot": 3, "base_mode": 81, "custom_mode": 4,
      "system_status": 4, "mavlink_version": 3})

emit("GLOBAL_POSITION_INT",
     M.MAVLink_global_position_int_message(
         time_boot_ms=123456, lat=213000000, lon=917000000, alt=3210000,
         relative_alt=3200000, vx=1200, vy=-350, vz=-40, hdg=21550),
     {"time_boot_ms": 123456, "lat": 213000000, "lon": 917000000,
      "alt": 3210000, "relative_alt": 3200000, "vx": 1200, "vy": -350,
      "vz": -40, "hdg": 21550})

emit("MISSION_ITEM_INT",
     M.MAVLink_mission_item_int_message(
         target_system=1, target_component=1, seq=3, frame=3, command=16,
         current=0, autocontinue=1, param1=0.0, param2=0.0, param3=0.0,
         param4=float("nan"), x=205000000, y=912000000, z=3000.0,
         mission_type=0),
     {"target_system": 1, "target_component": 1, "seq": 3, "frame": 3,
      "command": 16, "current": 0, "autocontinue": 1, "param1": 0.0,
      "param2": 0.0, "param3": 0.0, "x": 205000000, "y": 912000000,
      "z": 3000.0, "mission_type": 0})

emit("COMMAND_LONG",
     M.MAVLink_command_long_message(
         target_system=1, target_component=1, command=400, confirmation=0,
         param1=1.0, param2=0.0, param3=0.0, param4=0.0, param5=0.0,
         param6=0.0, param7=0.0),
     {"target_system": 1, "target_component": 1, "command": 400,
      "confirmation": 0, "param1": 1.0})

emit("SET_MODE",
     M.MAVLink_set_mode_message(target_system=1, base_mode=1, custom_mode=10),
     {"target_system": 1, "base_mode": 1, "custom_mode": 10})

emit("MISSION_COUNT",
     M.MAVLink_mission_count_message(target_system=1, target_component=1,
                                     count=5, mission_type=0),
     {"target_system": 1, "target_component": 1, "count": 5,
      "mission_type": 0})

emit("STATUSTEXT",
     M.MAVLink_statustext_message(severity=6, text=b"AIEXNET LINK OK",
                                  id=0, chunk_seq=0),
     {"severity": 6, "text": "AIEXNET LINK OK", "id": 0, "chunk_seq": 0})

emit("VFR_HUD",
     M.MAVLink_vfr_hud_message(airspeed=31.5, groundspeed=33.2, heading=215,
                               throttle=62, alt=3200.0, climb=0.4),
     {"airspeed": 31.5, "groundspeed": 33.2, "heading": 215, "throttle": 62,
      "alt": 3200.0, "climb": 0.4})

emit("SYS_STATUS",
     M.MAVLink_sys_status_message(
         onboard_control_sensors_present=1467, onboard_control_sensors_enabled=1263,
         onboard_control_sensors_health=1467, load=350, voltage_battery=50100,
         current_battery=1200, battery_remaining=78, drop_rate_comm=0,
         errors_comm=0, errors_count1=0, errors_count2=0, errors_count3=0,
         errors_count4=0),
     {"voltage_battery": 50100, "current_battery": 1200,
      "battery_remaining": 78, "load": 350})

emit("GPS_RAW_INT",
     M.MAVLink_gps_raw_int_message(
         time_usec=1700000000000000, fix_type=6, lat=213000000, lon=917000000,
         alt=3210000, eph=90, epv=120, vel=3320, cog=21550,
         satellites_visible=21, alt_ellipsoid=0, h_acc=0, v_acc=0, vel_acc=0,
         hdg_acc=0, yaw=0),
     {"fix_type": 6, "lat": 213000000, "lon": 917000000,
      "satellites_visible": 21, "vel": 3320})

json.dump(cases, sys.stdout, indent=1)
