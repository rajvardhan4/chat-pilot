<?php
namespace ChatPilot\Settings;

// Prevent direct file access.
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class Sanitizer
 * Input sanitation filters for configurations and database transactions.
 */
class Sanitizer {

	/**
	 * Sanitizes boolean flags.
	 *
	 * @param mixed $value Incoming raw form value.
	 * @return bool Sanitized boolean state.
	 */
	public static function sanitize_boolean( $value ) {
		return filter_var( $value, FILTER_VALIDATE_BOOLEAN );
	}

	/**
	 * Sanitizes alphanumeric API keys or general secrets.
	 *
	 * @param string $value Raw api key string.
	 * @return string Sanitized alphanumeric/trimmed key string.
	 */
	public static function sanitize_api_key( $value ) {
		return sanitize_text_field( trim( $value ) );
	}

	/**
	 * Sanitizes general system text field inputs.
	 *
	 * @param string $value Raw field text.
	 * @return string Sanitized text field.
	 */
	public static function sanitize_text( $value ) {
		return sanitize_text_field( $value );
	}

	/**
	 * Sanitizes email address inputs.
	 *
	 * @param string $value Raw email.
	 * @return string Clean email address or empty string if invalid.
	 */
	public static function sanitize_email( $value ) {
		return sanitize_email( trim( $value ) );
	}

	/**
	 * Sanitizes integer inputs with optional min/max bounds.
	 *
	 * @param mixed $value Raw number.
	 * @param int   $min Minimum value.
	 * @param int   $max Maximum value.
	 * @return int Sanitized integer.
	 */
	public static function sanitize_integer( $value, $min = null, $max = null ) {
		$val = intval( $value );
		if ( null !== $min && $val < $min ) {
			$val = $min;
		}
		if ( null !== $max && $val > $max ) {
			$val = $max;
		}
		return $val;
	}

	/**
	 * Sanitizes float inputs with optional min/max bounds.
	 *
	 * @param mixed $value Raw float.
	 * @param float $min Minimum value.
	 * @param float $max Maximum value.
	 * @return float Sanitized float.
	 */
	public static function sanitize_float( $value, $min = null, $max = null ) {
		$val = floatval( $value );
		if ( null !== $min && $val < $min ) {
			$val = $min;
		}
		if ( null !== $max && $val > $max ) {
			$val = $max;
		}
		return $val;
	}

	/**
	 * Sanitizes select inputs against allowed options.
	 *
	 * @param string $value Incoming choice.
	 * @param array  $allowed Allowed values.
	 * @param string $default Fallback value.
	 * @return string Validated option.
	 */
	public static function sanitize_select( $value, array $allowed, $default = '' ) {
		$clean = sanitize_key( $value );
		return in_array( $clean, $allowed, true ) ? $clean : $default;
	}

	/**
	 * Sanitizes and validates a version release tag string.
	 *
	 * @param string $version Raw version tag.
	 * @return string Clean version string, defaults to '1.0.0'.
	 */
	public static function sanitize_version( $version ) {
		$clean = preg_replace( '/[^0-9\.\-a-zA-Z]/', '', $version );
		return ! empty( $clean ) ? $clean : '1.0.0';
	}
}
