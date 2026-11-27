@echo off
:: SafeSpeak Static IP Configurator
:: Requires Administrator Privileges
title Setting Static IP for SafeSpeak Laptop

echo =====================================================================
echo  SafeSpeak - Setting Static IP on Laptop
echo =====================================================================
echo  Adapter: Ethernet 6 (Realtek USB GbE)
echo  Static IP: 192.168.1.50
echo  Subnet Mask: 255.255.255.0
echo  Default Gateway: 192.168.1.1
echo  DNS: 192.168.1.1, 8.8.8.8
echo =====================================================================
echo.

netsh interface ipv4 set address name="Ethernet 6" static 192.168.1.50 255.255.255.0 192.168.1.1
netsh interface ipv4 set dns name="Ethernet 6" static 192.168.1.1
netsh interface ipv4 add dns name="Ethernet 6" 8.8.8.8 index=2

echo.
if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Your laptop is now PERMANENTLY fixed at: 192.168.1.50
    echo (echo 192.168.1.50) > "%~dp0laptop_ip.txt"
) else (
    echo [ERROR] Please right-click this script and select "Run as administrator"!
)
echo.
pause
