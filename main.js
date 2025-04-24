import { print_image, connect_printer } from "./printer.js";
import { info, warn, error } from "./message.js";

function $(query){
    return document.querySelector(query);
}

document.addEventListener("DOMContentLoaded", () => {
    if (typeof navigator.bluetooth == "undefined"){
        error("WebBluetooth is not supported in this browser.")
    }
    $("#connect-btn").addEventListener("click", (event) => {
        connect_printer();
    })
    $("#print-btn").addEventListener("click", (event) => {
        print_image($("#image-canvas"));
    })
    $("#image-file").addEventListener("change", (event) => {
        console.log("image added");
        var file = event.target.files[0];
        if(!file){return;}
        var reader = new FileReader();
        var canvas = $("#image-canvas");
        var context = canvas.getContext("2d");
        reader.onload = (e) => {
            let image = new Image();
            image.onload = () => {
                context.clearRect(0, 0, canvas.width, canvas.height);
                let ratio = image.height/image.width;
                let scaled_height = canvas.width*ratio;
                canvas.height = scaled_height;
                context.drawImage(image, 0, 0, canvas.width, scaled_height);
                console.log("drawn");
            };
            image.src = e.target.result; 
            console.log(image.src)
        };
        reader.readAsDataURL(file);
    })
})