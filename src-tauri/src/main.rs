//! LumenDeck binary entry point.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumendeck_lib::run();
}
