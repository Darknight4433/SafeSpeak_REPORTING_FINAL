@echo off
:: Revert adapter back to dynamic DHCP
title Reverting to Automatic DHCP
netsh interface ipv4 set address name="Ethernet 6" source=dhcp
netsh interface ipv4 set dns name="Ethernet 6" source=dhcp
echo Reverted to Automatic IP (DHCP).
pause
