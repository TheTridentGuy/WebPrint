import { print_image, connect_printer } from "./printer.js";

function $(query){
    return document.querySelector(query);
}
document.addEventListener("DOMContentLoaded", () => {
    $("#connect-btn").addEventListener("click", (event) => {
        connect_printer();
    })
})