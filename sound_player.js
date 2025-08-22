/*!
 * Rumble Raid Helper - sound_player.js
 * Version: v4.0.0
 * Description: Lightweight audio player page for playing Raid/Rant alert sounds.
 *              Designed to be opened in a small popup window and self-close
 *              once playback completes.
 *
 * Core responsibilities
 * ─────────────────────
 * • Input
 *   - Reads query string (?src=...) for the audio file to play.
 *   - Decodes URI to support spaces, special chars, etc.
 *
 * • Playback
 *   - Instantiates new Audio() with the given source.
 *   - Begins playback immediately.
 *   - Catches and logs any playback errors (e.g., autoplay restrictions).
 *
 * • Lifecycle
 *   - If playback finishes successfully → closes the popup window.
 *   - If no `src` param or playback fails → logs and closes immediately.
 *
 * • Usage
 *   - Invoked by extension features (Raid/Rant alerts) when an alert
 *     sound needs to be played without interfering with the main page.
 *
 * Author: TheRealTombi
 * Website: https://rumble.com/TheRealTombi
 * License: MIT
 */

const params = new URLSearchParams(window.location.search);
const soundSrc = params.get('src');

if (soundSrc) {
    const audio = new Audio(decodeURIComponent(soundSrc));
    audio.onended = () => window.close();
    audio.play().catch(e => {
        console.error("Audio playback failed:", e);
        window.close();
    });
} else {
    window.close();
}