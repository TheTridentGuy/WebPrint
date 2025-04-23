import { print_image, connect_printer } from "./printer.js";

function $(query){
    return document.querySelector(query);
}
document.addEventListener("DOMContentLoaded", () => {
    $("#connect-btn").addEventListener("click", (event) => {
        connect_printer();
    })
    $("#printer-btn").addEventListener("click", (event) => {
        print_image($("#image-canvas"));
    })
})