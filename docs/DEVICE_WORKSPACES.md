# Devices and saved layouts

Open **Devices**, then open the device you want to configure. The dashboard keeps
the selected device in its URL so you can bookmark or share a link with another
browser signed in to the same account.

Each device has its own named layouts, selected layout, display profile and display
time zone. Create a layout, give it a useful name such as “Kitchen overview” or
“Calendar”, then open its editor to arrange widgets. Select a saved layout to use
it on that device. Saving a layout changes the next image delivered to that
device; a sleeping device receives changes when it next connects.

Integration credentials and source settings remain shared across your account.
Configure weather, calendar, Home Assistant and other sources on **Integrations**.
The layout decides where enabled widgets appear. Notes, images and template
backups are also account settings, separately identified in the interface.

An existing device initially uses the account's previous display settings. Its
first device-specific save copies those presentation settings, including existing
scheduled pages, into its own configuration. Other devices and the original
account settings remain intact. Devices without their own configuration continue
to inherit account settings. A device configuration never follows a device into
another owner's account.

## Database deployment

Apply `backend/src/db/migrations/018_device_displays.sql` before configuring
devices. Existing installations should apply only migrations they have not
already run. Raspberry Pi installations use the migration runbook in
`infra/raspberry-pi/README.md`; the same SQL migration is used for hosted PostgreSQL.

The bundled ESP32 firmware supports the 250 × 122 monochrome profile at rotation
0°. Other profiles require a compatible client and display driver.
