// yes i ripped this from https://github.com/dropalltables/catprinter/blob/main/js/printer.js and refactored it a bunch
// TODO: this code is ass, clean it up
import { info, warn, error } from "./message.js";

export const PRINTER_WIDTH = 384;
export const PRINTER_WIDTH_BYTES = PRINTER_WIDTH / 8;
export const MIN_DATA_BYTES = 90 * PRINTER_WIDTH_BYTES;
const MAIN_SERVICE_UUID = "0000ae30-0000-1000-8000-00805f9b34fb";
const MAIN_SERVICE_UUID_ALT = "0000af30-0000-1000-8000-00805f9b34fb";
const CONTROL_WRITE_UUID = "0000ae01-0000-1000-8000-00805f9b34fb";
const DATA_WRITE_UUID = "0000ae03-0000-1000-8000-00805f9b34fb";

const command_ids = { 
    get_status: 0xA1, 
    get_battery: 0xAB,
    print: 0xA9, 
    print_complete: 0xAA 
};
let notify_char;
let pending_resolvers = new Map();
let last_known_battery_level = null;

const crc8_table = [
    0x00,0x07,0x0E,0x09,0x1C,0x1B,0x12,0x15,0x38,0x3F,0x36,0x31,0x24,0x23,0x2A,0x2D,
    0x70,0x77,0x7E,0x79,0x6C,0x6B,0x62,0x65,0x48,0x4F,0x46,0x41,0x54,0x53,0x5A,0x5D,
    0xE0,0xE7,0xEE,0xE9,0xFC,0xFB,0xF2,0xF5,0xD8,0xDF,0xD6,0xD1,0xC4,0xC3,0xCA,0xCD,
    0x90,0x97,0x9E,0x99,0x8C,0x8B,0x82,0x85,0xA8,0xAF,0xA6,0xA1,0xB4,0xB3,0xBA,0xBD,
    0xC7,0xC0,0xC9,0xCE,0xDB,0xDC,0xD5,0xD2,0xFF,0xF8,0xF1,0xF6,0xE3,0xE4,0xED,0xEA,
    0xB7,0xB0,0xB9,0xBE,0xAB,0xAC,0xA5,0xA2,0x8F,0x88,0x81,0x86,0x93,0x94,0x9D,0x9A,
    0x27,0x20,0x29,0x2E,0x3B,0x3C,0x35,0x32,0x1F,0x18,0x11,0x16,0x03,0x04,0x0D,0x0A,
    0x57,0x50,0x59,0x5E,0x4B,0x4C,0x45,0x42,0x6F,0x68,0x61,0x66,0x73,0x74,0x7D,0x7A,
    0x89,0x8E,0x87,0x80,0x95,0x92,0x9B,0x9C,0xB1,0xB6,0xBF,0xB8,0xAD,0xAA,0xA3,0xA4,
    0xF9,0xFE,0xF7,0xF0,0xE5,0xE2,0xEB,0xEC,0xC1,0xC6,0xCF,0xC8,0xDD,0xDA,0xD3,0xD4,
    0x69,0x6E,0x67,0x60,0x75,0x72,0x7B,0x7C,0x51,0x56,0x5F,0x58,0x4D,0x4A,0x43,0x44,
    0x19,0x1E,0x17,0x10,0x05,0x02,0x0B,0x0C,0x21,0x26,0x2F,0x28,0x3D,0x3A,0x33,0x34,
    0x4E,0x49,0x40,0x47,0x52,0x55,0x5C,0x5B,0x76,0x71,0x78,0x7F,0x6A,0x6D,0x64,0x63,
    0x3E,0x39,0x30,0x37,0x22,0x25,0x2C,0x2B,0x06,0x01,0x08,0x0F,0x1A,0x1D,0x14,0x13,
    0xAE,0xA9,0xA0,0xA7,0xB2,0xB5,0xBC,0xBB,0x96,0x91,0x98,0x9F,0x8A,0x8D,0x84,0x83,
    0xDE,0xD9,0xD0,0xD7,0xC2,0xC5,0xCC,0xCB,0xE6,0xE1,0xE8,0xEF,0xFA,0xFD,0xF4,0xF3
];

function encode_1bpp_row(row_bool) {
    console.debug(`Encoding row of ${row_bool.length} pixels to ${PRINTER_WIDTH_BYTES} bytes`);
    if (row_bool.length !== PRINTER_WIDTH) {
        const error = `Row length must be ${PRINTER_WIDTH}, got ${row_bool.length}`;
        console.error(error);
        throw new Error(error);
    }
    const row_bytes = new Uint8Array(PRINTER_WIDTH_BYTES);
    for (let byte_index = 0; byte_index < PRINTER_WIDTH_BYTES; byte_index++) {
        let byte_val = 0;
        for (let bit = 0; bit < 8; bit++) {
            if (row_bool[byte_index * 8 + bit]) {
                byte_val |= 1 << bit;
            }
        }
        row_bytes[byte_index] = byte_val;
    }
    const first_bytes = Array.from(row_bytes.slice(0, 3)).map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ");
    const last_bytes = Array.from(row_bytes.slice(-3)).map(b => "0x" + b.toString(16).padStart(2, "0")).join(" ");
    console.debug(`Row encoded: First bytes: ${first_bytes}... Last bytes: ${last_bytes}`);
    return row_bytes;
}

function prepare_image_data_buffer(image_rows_bool) {
    const height = image_rows_bool.length;
    console.info(`Preparing image data buffer for ${height} rows`, { 
        width: PRINTER_WIDTH, 
        bytes_per_row: PRINTER_WIDTH_BYTES,
        min_bytes: MIN_DATA_BYTES 
    });
    let buffer = new Uint8Array(0);
    for (let y = 0; y < height; y++) {
        const row_bytes = encode_1bpp_row(image_rows_bool[y]);
        const new_buf = new Uint8Array(buffer.length + row_bytes.length);
        new_buf.set(buffer);
        new_buf.set(row_bytes, buffer.length);
        buffer = new_buf;
        if (y % 50 === 0 || y === height - 1) {
            console.debug(`Processed row ${y+1}/${height} (${Math.round((y+1)/height*100)}%)`);
        }
    }
    if (buffer.length < MIN_DATA_BYTES) {
        console.info(`Padding buffer to minimum size: ${buffer.length} -> ${MIN_DATA_BYTES} bytes`);
        const pad = new Uint8Array(MIN_DATA_BYTES - buffer.length);
        const new_buf = new Uint8Array(buffer.length + pad.length);
        new_buf.set(buffer);
        new_buf.set(pad, buffer.length);
        buffer = new_buf;
    }
    console.info(`Image buffer prepared`, {
        total_bytes: buffer.length,
        data_bytes: height * PRINTER_WIDTH_BYTES,
        padding_bytes: buffer.length - (height * PRINTER_WIDTH_BYTES)
    });
    return buffer;
}

function calculate_crc8(data) {
    let crc = 0;
    for (let byte of data) crc = crc8_table[(crc ^ byte) & 0xFF];
    return crc;
}

function create_command(cmd_id, payload) {
    const length = payload.length;
    const header = [0x22, 0x21, cmd_id & 0xFF, 0x00, length & 0xFF, (length >> 8) & 0xFF];
    const command = new Uint8Array(header.concat(Array.from(payload)));
    const crc = calculate_crc8(payload);
    console.debug(`Creating command 0x${cmd_id.toString(16).toUpperCase()}`, { 
        payload_length: length,
        crc: "0x" + crc.toString(16).padStart(2, "0")
    });
    return new Uint8Array([...command, crc, 0xFF]);
}

function cmd_set_intensity(intensity = 0x5D) { 
    console.debug(`Setting print intensity to 0x${intensity.toString(16).toUpperCase()}`);
    return create_command(0xA2, Uint8Array.of(intensity)); 
}

function cmd_print_request(lines, mode = 0) {
    console.info(`Sending print request`, { lines, mode });
    const data = new Uint8Array(4);
    data[0] = lines & 0xFF;
    data[1] = (lines >> 8) & 0xFF;
    data[2] = 0x30;
    data[3] = mode;
    return create_command(0xA9, data);
}

function cmd_flush() { 
    console.debug(`Sending flush command`);
    return create_command(0xAD, Uint8Array.of(0x00)); 
}

function handle_notification(event) {
    const data = new Uint8Array(event.target.value.buffer);
    if (data[0] !== 0x22 || data[1] !== 0x21) {
        console.warn(`Ignoring unexpected notification format`);
        return;
    }
    const cmd_id = data[2];
    const length = data[4] | (data[5] << 8);
    const payload = data.slice(6, 6 + length);
    console.debug(`Received notification for command 0x${cmd_id.toString(16).toUpperCase()}`, { 
        payload_length: length
    });
    const resolver = pending_resolvers.get(cmd_id);
    if (resolver) {
        resolver(payload);
        pending_resolvers.delete(cmd_id);
    } else {
        console.warn(`No pending resolver for command 0x${cmd_id.toString(16).toUpperCase()}`);
    }
}

function wait_for_notification(cmd_id, timeout_ms = 10000) {
    console.debug(`Waiting for notification response to command 0x${cmd_id.toString(16).toUpperCase()}`, {
        timeout_ms
    });
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending_resolvers.delete(cmd_id);
            const error = `Timeout waiting for notification 0x${cmd_id.toString(16)}`;
            console.error(error);
            reject(new Error(error));
        }, timeout_ms);
        pending_resolvers.set(cmd_id, (payload) => {
            clearTimeout(timer);
            console.debug(`Notification for command 0x${cmd_id.toString(16).toUpperCase()} resolved`);
            resolve(payload);
        });
    });
}
let device, server, control_char, data_char;

export async function connect_printer() {
    info("Connecting to MXW01...");
    if (typeof navigator.bluetooth === "undefined") {
        error("Bluetooth not supported in this browser");
    }
    if (device && device.gatt.connected) {
        info("Connected to printer.");
        return;
    }
    info("Requesting Bluetooth device...");
    try {
        device = await navigator.bluetooth.requestDevice({
            filters: [
                { services: [MAIN_SERVICE_UUID] },
                { services: [MAIN_SERVICE_UUID_ALT] }
            ],
            optionalServices: [MAIN_SERVICE_UUID, MAIN_SERVICE_UUID_ALT, CONTROL_WRITE_UUID, DATA_WRITE_UUID]
        });
        info(`Device found: "${device.name || "Unknown device"}"`);
    } catch (err) {
        warn("Failed to find device...");
        device = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: [MAIN_SERVICE_UUID, MAIN_SERVICE_UUID_ALT, CONTROL_WRITE_UUID, DATA_WRITE_UUID]
        });
        info(`Device found (fallback): "${device.name || "Unknown device"}"`);
    }
    info("Connecting to GATT server...");
    server = await device.gatt.connect();
    info("Connected to GATT server.");
    let service;
    try {
        console.debug(`Attempting to get primary service: ${MAIN_SERVICE_UUID}`);
        service = await server.getPrimaryService(MAIN_SERVICE_UUID);
    } catch (error) {
        console.warn(`Primary service not found with MAIN_SERVICE_UUID, trying alternate`, { error: error.message });
        service = await server.getPrimaryService(MAIN_SERVICE_UUID_ALT);
        console.debug("Primary service obtained (using alternate UUID)");
    }
    control_char = await service.getCharacteristic(CONTROL_WRITE_UUID);
    data_char = await service.getCharacteristic(DATA_WRITE_UUID);
    notify_char = await service.getCharacteristic("0000ae02-0000-1000-8000-00805f9b34fb");
    await notify_char.startNotifications();
    notify_char.addEventListener("characteristicvaluechanged", handle_notification);
    info("Connected to printer.");
}

export async function get_battery_level() {
    try {
        try {
            await control_char.writeValue(create_command(command_ids.get_battery, Uint8Array.of(0x00)));
            const battery_payload = await wait_for_notification(command_ids.get_battery, 5000);
            if (battery_payload && battery_payload.length > 0) {
                last_known_battery_level = battery_payload[0];
                console.info("Battery level retrieved using AB command", { level: last_known_battery_level });
                return last_known_battery_level;
            }
        } catch (error) {
            console.warn("Failed to get battery level using AB command", { error: error.message });
        }
        const status_result = await get_printer_status();
        if (status_result && status_result.battery_level !== undefined) {
            last_known_battery_level = status_result.battery_level;
            return last_known_battery_level;
        }
        if (last_known_battery_level !== null) {
            console.warn("Using last known battery level", { level: last_known_battery_level });
            return last_known_battery_level;
        }
        const error = "Failed to retrieve battery level";
        console.error(error);
        throw new Error(error);
    } catch (error) {
        console.error("Error getting battery level", { message: error.message });
        throw error;
    }
}

export async function get_printer_status() {
  if (!control_char) {
    console.error("Control characteristic not initialized");
    throw new Error("Not connected to printer");
  }

  try {
    console.log("Querying printer status...");
    await control_char.writeValue(create_command(command_ids.get_status, Uint8Array.of(0x00)));
    const status_payload = await wait_for_notification(command_ids.get_status, 5000);

    if (!status_payload) {
      console.warn("No status response received");
      return null;
    }

    const result = {
      raw: status_payload,
      is_error: false,
      error_code: null,
      battery_level: null,
      temperature: null,
      status_code: null,
    };

    if (status_payload.length >= 7) {
      result.status_code = status_payload[6];
    }

    if (status_payload.length >= 10) {
      result.battery_level = status_payload[9];
    }

    if (status_payload.length >= 11) {
      result.temperature = status_payload[10];
    }

    if (status_payload.length >= 13 && status_payload[12] !== 0) {
      result.is_error = true;
      if (status_payload.length >= 14) {
        result.error_code = status_payload[13];
      }
    }

    console.info("Printer status retrieved", result);
    return result;
  } catch (error) {
    console.error("Error querying printer status", { message: error.message });
    throw error;
  }
}

export function is_printer_connected() {
    return !!(device && device.gatt.connected);
}

export function get_last_known_battery_level() {
    return last_known_battery_level;
}

export async function print_image(canvas) {
    info("Preparing to print...")
    const start_time = Date.now();
    
    const ctx = canvas.getContext("2d");
    const { width, height } = canvas;
    
    console.info('Canvas dimensions', { width, height });
    
    if (width !== PRINTER_WIDTH) {
        const error = `Canvas width ${width} != expected printer width ${PRINTER_WIDTH}`;
        console.error(error);
        throw new Error(error);
    }
    
    console.info('Converting image to 1-bit format');
    const img_data = ctx.getImageData(0, 0, width, height).data;
    const rows_bool = [];
    
    for (let y = 0; y < height; y++) {
        const row = new Array(width).fill(false);
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            const luminance = 0.299 * img_data[i] + 0.587 * img_data[i + 1] + 0.114 * img_data[i + 2];
            row[x] = luminance < 128;
        }
        rows_bool.push(row);
        
        if (y % Math.round(height / 10) === 0) {
            console.debug(`Progress: ${Math.round(y / height * 20)}%`);
        }
    }
    
    console.info('Rotating image 180° for printing');
    const rotated_rows = rows_bool.reverse().map(row => row.slice().reverse());
    
    const buffer = prepare_image_data_buffer(rotated_rows);
    
    const stats = {
        image_width: width,
        image_height: height,
        bytes_per_row: PRINTER_WIDTH_BYTES,
        total_rows: height,
        total_bytes: buffer.length,
        chunk_size: PRINTER_WIDTH_BYTES,
        total_chunks: Math.ceil(buffer.length / PRINTER_WIDTH_BYTES)
    };
    
    console.info('Print job statistics', stats);
    
    try {
        console.debug('Step 1: Set print intensity');
        await control_char.writeValue(cmd_set_intensity());
        console.debug('Step 2: Request printer status');
        await control_char.writeValue(create_command(command_ids.get_status, Uint8Array.of(0x00)));
        const status_payload = await wait_for_notification(command_ids.get_status, 5000);
        
        console.debug('Received status payload', { 
            length: status_payload?.length || 0
        });
        
        if (!status_payload) {
            console.warn('No status response, proceeding anyway');
        } else if (status_payload.length >= 13 && status_payload[12] !== 0) {
            const error_code = status_payload[13];
            const error = `Printer status error code: ${error_code}`;
            console.error(error, { status_code: error_code });
            throw new Error(error);
        } else {
            let status_info = {};
            if (status_payload.length >= 5) {
                status_info.voltage = status_payload[4];
            }
            if (status_payload.length >= 8) {
                status_info.temperature = status_payload[5] | (status_payload[6] << 8);
            }
            console.info('Printer status OK', status_info);
        }
        console.debug('Step 3: Send print request');
        await control_char.writeValue(cmd_print_request(height, 0));
        const print_ack = await wait_for_notification(command_ids.print, 5000);
        if (!print_ack || print_ack[0] !== 0) {
            const error = 'Print request rejected: ' + (print_ack ? print_ack[0] : 'no response');
            console.error(error);
            throw new Error(error);
        } else {
            console.info('Print request accepted');
        }
        const chunk_size = PRINTER_WIDTH_BYTES;
        let pos = 0;
        let chunk_count = 0;
        const total_chunks = Math.ceil(buffer.length / chunk_size);
        info("Printing image...")
        console.info('Starting data transfer', {
            total_bytes: buffer.length,
            chunk_size,
            total_chunks
        });
        
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        while (pos < buffer.length) {
            const chunk = buffer.slice(pos, pos + chunk_size);
            chunk_count++;
            
            console.debug(`Sending chunk ${chunk_count}/${total_chunks}`, { 
            bytes: chunk.length,
            position: pos
            });
            
            await data_char.writeValueWithoutResponse(chunk);
            pos += chunk.length;
            await sleep(15);
        }
        
        console.info('Data transfer complete', {
            bytes_sent: pos,
            chunks_transferred: chunk_count
        });
        console.debug('Step 5: Sending flush command');
        await control_char.writeValue(cmd_flush());
        console.debug('Step 6: Waiting for print completion notification');
        const complete = await wait_for_notification(command_ids.print_complete, 20000);
        
        if (!complete) {
            console.warn('No print-complete notification received');
        } else {
            const print_time = (Date.now() - start_time) / 1000;
            console.info('Print completed successfully', { 
            execution_time: print_time.toFixed(1) + 's',
            lines_per_second: (height / print_time).toFixed(1)
            });
            info("Connected to printer.")
        }
        } catch (error) {
        error("Unknown error during printing.")
        console.error('Printing failed', { message: error.message });
        throw error;
        }
    }
