#[macro_use]
extern crate napi_derive;

pub mod types;
pub mod math;
pub mod parser;
pub mod engine;

#[napi]
pub fn health_check() -> String {
    "a11y-audit-native ok".to_string()
}
