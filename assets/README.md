# Assets Directory

This directory contains static assets used by the bot.

## Required Assets

### cage.png
**Required for:** `/cage` command
**Recommended size:** 512x512 pixels
**Format:** PNG with transparency
**Purpose:** Overlay image for the `/cage` command. The transparent areas will show the user's avatar through.

To use the `/cage` command:
1. Create a 512x512 PNG image with your desired cage design
2. Save it as `cage.png` in this directory
3. Ensure transparent areas where you want the avatar to show through

If `cage.png` is missing, the `/cage` command will return an error message to the user.
