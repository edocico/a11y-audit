#[macro_use]
extern crate napi_derive;

pub mod types;

#[napi]
pub fn health_check() -> String {
    "a11y-audit-native ok".to_string()
}
