<?php
namespace ChatPilot\Api;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class ConfigCache
 * Caches the widget configuration pulled from Chat Pilot Cloud.
 *
 * Why cache at all: the widget must render on the very first byte of a page,
 * and a page view cannot wait on an outbound HTTPS round trip. So the config is
 * cached in a transient and refreshed in the background.
 *
 * Why it is safe to cache: the payload is an explicit allow-list built by the
 * SaaS (see publicWidgetConfig). It contains no provider key, no prompt, no
 * account data - only what the browser already needs to draw the widget.
 *
 * Staleness is bounded: the cache TTL is short, and every settings change in
 * the portal bumps `configVersion`, so a stale payload self-corrects on the
 * next refresh rather than persisting until someone clears a cache by hand.
 */
class ConfigCache {

	const TRANSIENT = 'chat_pilot_widget_config';
	const OPTION_FALLBACK = 'chat_pilot_widget_config_last_good';

	/**
	 * Cache lifetime in seconds (default 60s for responsive portal updates).
	 *
	 * @return int
	 */
	public static function ttl() {
		return (int) apply_filters( 'chat_pilot_config_ttl', MINUTE_IN_SECONDS );
	}

	/**
	 * Flushes popular WordPress page caches and object cache.
	 */
	public static function purge_page_caches() {
		if ( function_exists( 'wp_cache_flush' ) ) {
			wp_cache_flush();
		}
		if ( has_action( 'litespeed_purge_all' ) ) {
			do_action( 'litespeed_purge_all' );
		}
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
		}
	}

	/**
	 * Writes the config to the transient and to a durable last-known-good copy.
	 *
	 * @param array $config Config payload from the SaaS.
	 */
	public static function store( array $config ) {
		$previous = get_option( self::OPTION_FALLBACK, null );
		set_transient( self::TRANSIENT, $config, self::ttl() );
		update_option( self::OPTION_FALLBACK, $config, false );

		if ( null !== $previous && serialize( $previous ) !== serialize( $config ) ) {
			self::purge_page_caches();
		}
	}

	/**
	 * Clears cached config.
	 */
	public static function flush() {
		delete_transient( self::TRANSIENT );
		delete_option( self::OPTION_FALLBACK );
		self::purge_page_caches();
	}

	/**
	 * Returns the widget config, refreshing from the SaaS when the cache is cold.
	 *
	 * If Chat Pilot is unreachable, the last known good config is used so the
	 * widget keeps rendering. Individual messages will still fail gracefully.
	 *
	 * @param bool $force Bypass the cache.
	 * @return array|null Config payload, or null when nothing is available.
	 */
	public static function get( $force = false ) {
		if ( ! $force ) {
			$cached = get_transient( self::TRANSIENT );
			if ( is_array( $cached ) && ! empty( $cached['widget'] ) ) {
				return $cached;
			}
		}

		if ( ! Connection::get_api_key() ) {
			return null;
		}

		$result = Client::get( '/api/' . CHAT_PILOT_API_VERSION . '/site/config' );

		if ( ! empty( $result['success'] ) && ! empty( $result['data']['widget'] ) ) {
			$config = array(
				'widget'   => $result['data']['widget'],
				'messages' => isset( $result['data']['messages'] ) ? $result['data']['messages'] : array(),
				'website'  => isset( $result['data']['website'] ) ? $result['data']['website'] : array(),
			);
			self::store( $config );
			return $config;
		}

		// Chat Pilot is unavailable or the key is no longer valid. Fall back to
		// the last good copy, but cache the failure briefly so an outage does
		// not turn into one outbound request per page view.
		set_transient( self::TRANSIENT . '_cooldown', 1, MINUTE_IN_SECONDS );

		$fallback = get_option( self::OPTION_FALLBACK, null );
		if ( is_array( $fallback ) && ! empty( $fallback['widget'] ) ) {
			// A revoked key or a disabled site must actually take the widget
			// down rather than serving a cached copy indefinitely.
			$hard_stop = array( 'site_key_invalid', 'site_key_revoked', 'website_disabled', 'account_suspended', 'subscription_inactive', 'domain_mismatch' );
			if ( isset( $result['code'] ) && in_array( $result['code'], $hard_stop, true ) ) {
				return null;
			}
			return $fallback;
		}

		return null;
	}

	/**
	 * True when a recent refresh attempt failed, so callers can skip retrying.
	 *
	 * @return bool
	 */
	public static function in_cooldown() {
		return (bool) get_transient( self::TRANSIENT . '_cooldown' );
	}
}
