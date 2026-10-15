# Sharing

Users can connect with each other, give a connection access to a device, and send
layouts, widgets and whole dashboards. Everything is on the **Sharing** page.
Apply `027_sharing.sql` to existing databases before deploying; until then the
rest of the app keeps working and sharing lists are simply empty.

## Connections

Enter an email address to send a request. The other person sees it under
**Sharing → Connections** and accepts or declines. Nothing can be shared with
someone who has not accepted. The response to a request is identical whether or
not the address has an account, so the form cannot be used to find accounts.
If both sides ask each other, the connection is made at once. Disconnecting
removes every device share between the two and withdraws unanswered items.

## Sharing a device (collaborator access)

The owner chooses a connection and a role per device:

| Role | Can |
|---|---|
| Viewer | See the device's saved screens (the server-rendered preview). |
| Editor | Also open the layout editor, draft previews, and save layouts, slideshow and display settings. |
| Owner only | Rename or delete the device, tokens and Wi-Fi delivery, manual refresh, Bluetooth details, sharing. |

A shared device **keeps drawing with its owner's integrations**. A collaborator
sees the rendered result, so they see whatever the owner's widgets show
(calendar events, charger status, and so on). They never receive credentials,
API keys, private feed or calendar URLs, tokens, the license key or the
hardware ID. The settings they can read are presentation only (layouts,
schedule, profile, time zone, language, which widgets are enabled). The owner
can remove access at any time, and a collaborator can leave from **Shared with you**.

Roles are checked on the server for every request (`resolveDeviceAccess`). A
device you have no access to answers 404, the same as one that does not exist.
A viewer asking to do something an editor may do gets 403.

## Sending layouts, widgets and dashboards (copies)

Items are **copied**, not linked. The sender picks a connection and one of:

- **Layout**: one saved layout or the base layout. Added to the recipient's device as a new saved layout.
- **Widget**: one widget with its size and options. Placed in the first free spot of the recipient's base layout or a saved layout, scaled to that layout's grid. Nothing already there moves.
- **Dashboard**: the base layout and all saved layouts. Replaces the target device's layouts. The recipient keeps their own time zone, quiet hours, panel profile and language.

The server builds the item from the sender's saved settings. Only built-in
widgets travel: additional news feeds, stock widgets and extra calendars belong
to the sender's account and are left out (the sender is told how many). The
recipient chooses a device they can edit, and the item is validated again when
applied. It then draws with the recipient's own sources. A sender can have at
most 20 unanswered items per recipient.

## API

All routes need sign-in.

| Route | Purpose |
|---|---|
| `GET /connections`, `POST /connections {email}` | List, or request (always `202`). |
| `POST /connections/:id/accept`, `DELETE /connections/:id` | Accept; decline, cancel or disconnect. |
| `GET /devices/:id/shares`, `PUT /devices/:id/shares {collaborator_id, role}` | Owner lists or sets a collaborator. |
| `DELETE /devices/:id/shares/:collaboratorId` | Owner removes; a collaborator leaves with `me`. |
| `GET /devices` | Adds `shared_devices` (id, name, role, owner; no keys). |
| `GET /shared-items?box=inbox\|sent`, `POST /shared-items {recipient_id, source, name?}` | List, or send. |
| `POST /shared-items/:id/accept {device_id, page_id?}`, `DELETE /shared-items/:id` | Apply a copy; decline (recipient) or withdraw (sender). |

`GET/PUT /devices/:id/display`, `/image/preview*` and `/preview` accept a device
shared with the caller. Draft previews and saving need the editor role.

## Limits and known gaps

- Viewers and editors see the owner's data through the rendered screen. Share devices only with people you would show that screen to.
- Shared devices are managed on the Sharing page and the layout editor; they are not yet in the Dashboard's device picker.
- Invitations to people without an account are not stored; ask them to sign up first.
- On the Raspberry Pi database, re-apply `init/permissions.sql` and the nginx allowlist after `027`; see `docs/RASPBERRY_PI_DATABASE_MIGRATION.md`.
