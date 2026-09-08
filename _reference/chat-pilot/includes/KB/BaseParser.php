<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class BaseParser
 * Abstract helper containing shared utility functions for all document and source parsers.
 */
abstract class BaseParser implements SourceParserInterface {

	/**
	 * Cleans and normalizes raw text for AI completions ingestion.
	 *
	 * @param string $text Raw text.
	 * @return string Normalized text.
	 */
	public function clean_text( $text ) {
		// Convert HTML entities back to characters.
		$text = html_entity_decode( $text, ENT_QUOTES | ENT_HTML5, 'UTF-8' );

		// Strip control characters and normalize newlines.
		$text = str_replace( array( "\r\n", "\r" ), "\n", $text );

		// Remove excessive white spaces.
		$text = preg_replace( '/[ \t]+/', ' ', $text );

		// Remove more than two consecutive newlines.
		$text = preg_replace( '/\n{3,}/', "\n\n", $text );

		return trim( $text );
	}

	/**
	 * Calculates word count.
	 *
	 * @param string $text Clean text.
	 * @return int Word count.
	 */
	public function count_words( $text ) {
		if ( empty( $text ) ) {
			return 0;
		}
		// Split by spaces/newlines.
		$words = preg_split( '/\s+/', trim( $text ) );
		return is_array( $words ) ? count( $words ) : 0;
	}

	/**
	 * Tokenizes query/text for scoring calculations.
	 *
	 * @param string $text Input text query.
	 * @return array Lowercase tokens array.
	 */
	public function tokenize( $text ) {
		$text = strtolower( $text );
		// Strip punctuation.
		$text = preg_replace( '/[^\w\s-]/', '', $text );
		$words = preg_split( '/\s+/', $text );
		
		if ( ! is_array( $words ) ) {
			return array();
		}

		// Filter empty tokens.
		return array_values( array_filter( array_map( 'trim', $words ) ) );
	}
}
