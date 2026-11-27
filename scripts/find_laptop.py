#!/usr/bin/env python3
"""
SafeSpeak Zero-Config Auto-Connect Engine for Raspberry Pi
Automatically discovers the laptop hosting SafeSpeak AI on ANY network (Hotspot, Wi-Fi, Ethernet).
Never requires typing an IP or port!
"""
import socket
import subprocess
import json
import sys
import time
import re

WS_PORT = 8765
WEB_PORT = 5173
DISCOVERY_PORT = 8767

def is_safespeak_server(ip):
    """Test if the given IP is actively running SafeSpeak voice server."""
    if not ip or ip == "127.0.0.1":
        return False
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(0.35)
        res = s.connect_ex((ip, WS_PORT))
        s.close()
        return res == 0
    except Exception:
        return False

def listen_udp_beacon(timeout=1.5):
    """Listen for the laptop's UDP auto-discovery beacon."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(('0.0.0.0', DISCOVERY_PORT))
        sock.settimeout(timeout)
        data, addr = sock.recvfrom(1024)
        sock.close()
        info = json.loads(data.decode('utf-8'))
        if info.get('service') == 'safespeak_ai':
            return addr[0]
    except Exception:
        pass
    return None

def get_arp_ips():
    """Get candidate IPs from the local ARP cache."""
    candidates = []
    try:
        output = subprocess.check_output(["arp", "-n"], stderr=subprocess.DEV_NULL, text=True)
        for line in output.splitlines():
            parts = line.split()
            if len(parts) >= 1 and re.match(r'^\d+\.\d+\.\d+\.\d+$', parts[0]):
                candidates.append(parts[0])
    except Exception:
        pass
    return candidates

def get_subnet_base():
    """Get the current local /24 subnet prefix e.g. '192.168.10.'"""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        my_ip = s.getsockname()[0]
        s.close()
        parts = my_ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3]) + "."
    except Exception:
        pass
    return None

def find_laptop():
    # 1. Try UDP Discovery Beacon
    beacon_ip = listen_udp_beacon(1.5)
    if beacon_ip and is_safespeak_server(beacon_ip):
        return beacon_ip

    # 2. Try mDNS Hostname
    for host in ["desktop-5tk1mc6.local", "DESKTOP-5TK1MC6.local"]:
        try:
            ip = socket.gethostbyname(host)
            if is_safespeak_server(ip):
                return ip
        except Exception:
            pass

    # 3. Check ARP cache
    for ip in get_arp_ips():
        if is_safespeak_server(ip):
            return ip

    # 4. Check known static/hotspot IPs
    known_candidates = [
        "192.168.10.39", "10.94.141.76", "192.168.1.50", "192.168.43.1",
        "192.168.10.1", "172.20.10.1", "192.168.1.1", "192.168.0.1"
    ]
    for ip in known_candidates:
        if is_safespeak_server(ip):
            return ip

    # 5. Quick scan across local subnet
    base = get_subnet_base()
    if base:
        for i in range(1, 60):
            ip = f"{base}{i}"
            if is_safespeak_server(ip):
                return ip

    return None

if __name__ == "__main__":
    found = find_laptop()
    if found:
        print(found)
        sys.exit(0)
    else:
        sys.exit(1)
