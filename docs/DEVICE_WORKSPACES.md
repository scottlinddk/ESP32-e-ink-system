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

## Slideshow on one device

In **Display mode and slideshow** on the selected device's dashboard, choose
**Slideshow** to rotate through all its named layouts in their saved order. Set a
duration for each layout from 60 to 86400 seconds (one minute to 24 hours), arrange
the order, and choose **Save display mode**. Slideshow mode needs at least one
named layout and supports up to 12. Add, rename or remove layouts in **Saved
layouts**. Other devices keep their own mode and schedule.

**Single layout** returns to the layout you previously selected. Changing modes
preserves that selection, the saved layouts, their order and their durations.
During a slideshow, selecting a layout for editing or preview does not pin that
layout on the physical display.

Quiet hours follow this device's configured **Quiet-hours time zone** and can cross midnight. The
server holds the page selected at the start of the quiet window until it ends.
Saving settings does not wake a sleeping device: it receives changes at its next
poll, which may be at the end of quiet hours. A device that polls less frequently
than the layout durations can skip pages. See [slideshow timing and quiet
hours](DISPLAY_SCHEDULES.md) for the rotation and refresh rules.

## Reading the live preview

The preview names the selected device and its hardware identifier. Its layout
label, image dimensions and render timestamp come from the same server response
as the image. During a slideshow, the label describes the page actually rendered,
even if collecting source data crosses a page transition. **Edit layout** opens
that page. An error marks a retained image as stale.

**Refresh preview** reloads the browser image. It does not confirm that a physical
screen has changed. **Push to display** uses Bluetooth setup mode; select the
registered device. Leaving the workspace cancels the transfer. When a Bluetooth
name is registered, a different selected name is rejected before image transfer.

## Requesting a screen update

Choose **Update device screen** on the selected device's dashboard to queue a full
refresh using its saved layout and latest available source data. Automatic updates
must be configured for that device first. **Queued** means the server is waiting
for its next check-in; the website cannot wake a sleeping ESP32. Quiet hours are
overridden for this one request when the device connects, then resume normally.
If the device is already asleep until quiet hours end, that remains its next
scheduled check-in. Provider cache and publishing intervals still apply.

The request is marked applied only after a compatible client reports that its
display driver completed the refresh. Downloading an image or refreshing the
browser preview does not acknowledge the request. Install firmware with manual
refresh acknowledgement support; older firmware may display the image while the
request remains queued. See [device delivery](DEVICE_DELIVERY.md) for setup and
the acknowledgement protocol.

## Database deployment

Apply `backend/src/db/migrations/018_device_displays.sql` before configuring
devices and `019_device_refresh.sql` before requesting screen updates.
Existing installations should apply only migrations they have not
already run. Raspberry Pi installations use the migration runbook in
`infra/raspberry-pi/README.md`; the same SQL migration is used for hosted PostgreSQL.

The bundled ESP32 firmware supports the 250 × 122 monochrome profile at rotation
0°. Other profiles require a compatible client and display driver.
