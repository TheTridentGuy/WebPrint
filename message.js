var INFO_COLOR = "var(--info)";
var WARN_COLOR = "var(--warn)";
var ERROR_COLOR = "var(--error)";

export function info(message) {
    _set_color(INFO_COLOR);
    _set_message(message);
}

export function warn(message) {
    _set_color(WARN_COLOR);
    _set_message(message);
}

export function error(message) {
    _set_color(ERROR_COLOR);
    _set_message(message);
}

function _set_color(color) {
    document.getElementById("message-box").style.color = color;
}

function _set_message(message) {
    document.getElementById("message-box").innerText = message;
}