import { print_image, connect_printer } from "./printer.js";
import { info, warn, error } from "./message.js";

function $(query){
    return document.querySelector(query);
}

var rotation = 0;
var rotation_step = 90;

document.addEventListener("DOMContentLoaded", () => {
    var connect_btn = $("#connect-btn");
    var print_btn = $("#print-btn");
    $("#left-btn").addEventListener("click", (event) => {
        rotate_left();
    });
    $("#right-btn").addEventListener("click", (event) => {
        rotate_right();
    });
    document.querySelectorAll("input").forEach((input) => {
        input.addEventListener("change", (event) => {
            if(event.target == $("#image-file")){
                rotation = 0;
            }
            draw_image();
        });
    });
    if (typeof navigator.bluetooth == "undefined"){
        error("WebBluetooth is not supported in this browser. Use Chrome on android, or Edge/Chrome on desktop.");
        connect_btn.style.cursor = "not-allowed";
        print_btn.style.cursor = "not-allowed";
    }else{
        connect_btn.addEventListener("click", (event) => {
            connect_printer();
        })
        print_btn.addEventListener("click", (event) => {
            print_image($("#image-canvas"));
        })
    }
})

function draw_image(){
    var file = $("#image-file").files[0];
    if(!file){return;}
    var reader = new FileReader();
    var canvas = $("#image-canvas");
    var context = canvas.getContext("2d");
    reader.onload = (e) => {
        var image = new Image();
        image.onload = () => {
            context.clearRect(0, 0, canvas.width, canvas.height);
            var ratio = image.height/image.width;
            var scaled_height = canvas.width*ratio;
            canvas.height = scaled_height;
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            var dither = $("input[type='radio']:checked").value;
            var image_data = context.getImageData(0, 0, canvas.width, canvas.height);
            var threshold = $("#threshold-val").value;
            if(dither == "dither-threshold"){
                threshold(image_data, threshold);
            }else if(dither == "dither-fs"){
                floyd_steinberg(image_data, threshold);
            }else{
                return;
            }
            context.putImageData(image_data, 0, 0);
        };
        get_rotated_image_data_url(e.target.result, rotation).then((data_url) => {
            image.src = data_url;
        }); 
    };
    reader.readAsDataURL(file);
}

function get_rotated_image_data_url(data_url, degrees) {
    return new Promise((resolve, reject) => {
        var image = new Image();
        image.onload = () => {
            var radians = degrees * Math.PI / 180;
            var sin = Math.abs(Math.sin(radians));
            var cos = Math.abs(Math.cos(radians));
            var original_width = image.width;
            var original_height = image.height;
            var new_width = original_width * cos + original_height * sin;
            var new_height = original_width * sin + original_height * cos;
            var hidden_canvas = document.createElement("canvas");
            hidden_canvas.width = new_width;
            hidden_canvas.height = new_height;
            var context = hidden_canvas.getContext("2d");
            context.translate(new_width / 2, new_height / 2);
            context.rotate(radians);
            context.drawImage(image, -original_width / 2, -original_height / 2);
            resolve(hidden_canvas.toDataURL());
        };
        image.src = data_url;
    });
}

function rotate_left(){
    rotation = (rotation-rotation_step)%360;
    draw_image();
}

function rotate_right(){
    rotation = (rotation+rotation_step)%360;
    draw_image();
}

function threshold(image_data, threshold){
    var data = image_data.data;
    for (let i = 0; i < data.length; i += 4) {
        var v = data[i] < threshold ? 0 : 255;
        data[i] = data[i + 1] = data[i + 2] = v;
    }
}

function floyd_steinberg(image_data, threshold){
    var width = image_data.width;
    var height = image_data.height;
    var data = image_data.data;
    var luminance = new Array(width * height);
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var idx = (i * width + j) * 4;
            luminance[i * width + j] = data[idx];
        }
    }
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var idx = i * width + j;
            var oldPixel = luminance[idx];
            var newPixel = oldPixel < threshold ? 0 : 255;
            luminance[idx] = newPixel;
            
            var error = oldPixel - newPixel;
            
            if (j + 1 < width) {
                luminance[idx + 1] += error * 7 / 16;
            }
            if (i + 1 < height) {
                if (j - 1 >= 0) {
                    luminance[(i + 1) * width + j - 1] += error * 3 / 16;
                }
                luminance[(i + 1) * width + j] += error * 5 / 16;
                if (j + 1 < width) {
                    luminance[(i + 1) * width + j + 1] += error * 1 / 16;
                }
            }
        }
    }
    for (let i = 0; i < height; i++) {
        for (let j = 0; j < width; j++) {
            var idx = (i * width + j) * 4;
            var v = luminance[i * width + j];
            data[idx] = data[idx + 1] = data[idx + 2] = v;
        }
    }
}