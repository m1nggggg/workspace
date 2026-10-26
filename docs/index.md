# Google Workspace Extension Documentation

This document provides an overview of the Google Workspace extension for Gemini
CLI.

## Available Tools

The extension provides the following tools:

### Authentication

- `auth.clear`: Clears the authentication credentials, forcing a re-login on the
  next request.
- `auth.refreshToken`: Manually triggers the token refresh process.

### Google Docs

- `docs.create`: Creates a new Google Doc.
- `docs.getSuggestions`: Retrieves suggested edits from a Google Doc.
- `drive.getComments`: Retrieves comments and replies from a Google Doc or other
  Drive file, including resolved status and quoted text where available.
- `docs.writeText`: Writes text to a Google Doc at a specified position.
- `docs.getText`: Reads a Google Doc without modifying it. Accepts a document ID
  or URL, an optional `tabId`, and `format` (`text` or `markdown`). The default
  `text` format preserves the existing plain-text response behavior. With
  `format: "markdown"`, reads document body content preserving bold, italic,
  strikethrough (`~~text~~`), underline (`<u>text</u>`), headings (levels 1–6),
  links, and simple tables. In Markdown mode, omitting `tabId` includes all
  tabs, including nested tabs. This mode returns JSON containing the document
  `title` and a `tabs` array with `tabId`, `title`, and `markdown` for each tab.
  Uses existing Docs permissions and belongs to the `docs.read` feature group.
  - Comments are read separately using `drive.getComments`; suggested changes
    are excluded from this preview and are read using `docs.getSuggestions`.
  - This is a best-effort text representation, not a visual export. Font sizes,
    colors, page layout, headers, footers, and footnotes are not preserved;
    images are references (`[Image: imageId]`), with an `images` metadata array
    on each tab. Floating images are referenced at their paragraph anchor. Lists
    use unordered Markdown bullets. Tables use their first row as the Markdown
    header; merged cells and nested table layouts are not faithfully
    represented.
- `docs.getImages`: Reads inline and floating images as MCP image content for a
  vision-capable model; does not modify the document. First call `docs.getText`
  with `format: "markdown"` to discover image IDs, then call `docs.getImages`
  with `documentId`, optional `tabId`, and optional `imageIds`. Without
  `imageIds`, loads the first five images across all (including nested) tabs, or
  the selected tab. Select specific IDs to load other images. Limits: five
  images per call, 5 MiB per image, 10 MiB total (before base64). Returns image
  labels, per-image status/errors, a remaining count, and image content. PNG,
  JPEG, GIF, and WebP are accepted. Temporary Google image URLs are fetched
  fresh and are not returned or logged. Uses existing Docs permissions and the
  `docs.read` feature group. The client/model must support image tool results;
  this tool does not perform OCR or call a separate model.
- `docs.replaceText`: Replaces all occurrences of a given text with new text in
  a Google Doc.
- `docs.formatText`: Applies formatting (bold, italic, headings, etc.) to text
  ranges in a Google Doc.

### Google Slides

- `slides.getText`: Retrieves the text content of a Google Slides presentation.
- `slides.getMetadata`: Gets metadata about a Google Slides presentation.
- `slides.getImages`: Downloads all images embedded in a Google Slides
  presentation to a local directory.
- `slides.getSlideThumbnail`: Downloads a thumbnail image for a specific slide
  in a Google Slides presentation to a local path.

### Google Sheets

- `sheets.getText`: Retrieves the content of a Google Sheets spreadsheet.
- `sheets.getRange`: Gets values from a specific range in a Google Sheets
  spreadsheet.
- `sheets.getMetadata`: Gets metadata about a Google Sheets spreadsheet.

### Google Drive

- `drive.search`: Searches for files and folders in Google Drive.
- `drive.findFolder`: Finds a folder by name in Google Drive.
- `drive.createFolder`: Creates a new folder in Google Drive.
- `drive.downloadFile`: Downloads a file from Google Drive to a local path.
- `drive.trashFile`: Moves a file or folder to the trash in Google Drive.
- `drive.renameFile`: Renames a file or folder in Google Drive.

### Google Calendar

- `calendar.list`: Lists all of the user's calendars.
- `calendar.createEvent`: Creates a new event in a calendar.
- `calendar.listEvents`: Lists events from a calendar.
- `calendar.getEvent`: Gets the details of a specific calendar event.
- `calendar.findFreeTime`: Finds a free time slot for multiple people to meet.
- `calendar.updateEvent`: Updates an existing event in a calendar.
- `calendar.respondToEvent`: Responds to a meeting invitation (accept, decline,
  or tentative).
- `calendar.deleteEvent`: Deletes an event from a calendar.

### Google Chat

- `chat.listSpaces`: Lists the spaces the user is a member of.
- `chat.findSpaceByName`: Finds a Google Chat space by its display name.
- `chat.sendMessage`: Sends a message to a Google Chat space.
- `chat.getMessages`: Gets messages from a Google Chat space.
- `chat.searchMessages`: Searches message contents server-side across joined
  conversations. Accepts a required `filter`, optional `pageSize` (1–100,
  default 25), and optional `pageToken`. Returns `results` (each containing a
  `message`) and an optional `nextPageToken`, newest first. For example:
  `{"filter":"deployment AND space.name = \"spaces/AAAAN2J52O8\""}`. Keep the
  filter and page size unchanged when paging. Uses existing Chat read
  permissions; `is_unread()` requires an additional read-state permission that
  this tool does not request. Google search excludes app-posted messages in
  spaces/group chats, Chat app DMs, private messages, blocked senders, and muted
  spaces. Use `chat.getMessages` to read thread context or list messages that
  search excludes. See
  [Google's search guide](https://developers.google.com/workspace/chat/search-messages).
- `chat.sendDm`: Sends a direct message to a user.
- `chat.findDmByEmail`: Finds a Google Chat DM space by a user's email address.
- `chat.listThreads`: Lists threads from a Google Chat space in reverse
  chronological order.
- `chat.setUpSpace`: Sets up a new Google Chat space with a display name and a
  list of members.

### Gmail

- `gmail.search`: Search for emails in Gmail using query parameters.
- `gmail.get`: Get the full content of a specific email message.
- `gmail.downloadAttachment`: Downloads an attachment from a Gmail message to a
  local file.
- `gmail.modify`: Modify a Gmail message.
- `gmail.batchModify`: Bulk modify up to 1,000 Gmail messages at once.
- `gmail.modifyThread`: Modify labels on all messages in a Gmail thread.
- `gmail.send`: Send an email message.
- `gmail.createDraft`: Create a draft email message.
- `gmail.sendDraft`: Send a previously created draft email.
- `gmail.listLabels`: List all Gmail labels in the user's mailbox.
- `gmail.createLabel`: Create a new Gmail label.

### Time

- `time.getCurrentDate`: Gets the current date. Returns both UTC (for API use)
  and local time (for user display), along with the timezone.
- `time.getCurrentTime`: Gets the current time. Returns both UTC (for API use)
  and local time (for user display), along with the timezone.
- `time.getTimeZone`: Gets the local timezone.

### People

- `people.getUserProfile`: Gets a user's profile information.
- `people.getMe`: Gets the profile information of the authenticated user.
- `people.getUserRelations`: Gets a user's relations (e.g., manager, spouse,
  assistant). Defaults to the authenticated user and supports filtering by
  relation type.

## Custom Commands

The extension includes several pre-configured commands for common tasks:

- `/calendar/get-schedule`: Show your schedule for today, or a specified date.
- `/calendar/clear-schedule`: Clear all events for a specific date or range by
  deleting or declining them.
- `/drive/search`: Searches Google Drive for files matching a query and displays
  their name and ID.
- `/gmail/search`: Searches for emails in Gmail matching a query and displays
  the sender, subject, and snippet.

## Release Notes

See the [Release Notes](release_notes.md) for details on new features and
changes.
