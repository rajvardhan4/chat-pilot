<?php
namespace ChatPilot\KB;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class PDFParser
 * Native pure-PHP extraction driver for PDF documents.
 * Decompresses stream objects and filters text blocks.
 */
class PDFParser extends BaseParser {

	/**
	 * Extracts plain text from a PDF file.
	 *
	 * @param array $config Source configuration array. Requires 'file_path'.
	 * @return array Parsed documents list.
	 */
	public function parse( array $config ) {
		if ( empty( $config['file_path'] ) || ! file_exists( $config['file_path'] ) ) {
			return array();
		}

		$data = file_get_contents( $config['file_path'] );
		if ( false === $data || empty( $data ) ) {
			return array();
		}

		$extracted_text = $this->extract_text_from_pdf( $data );
		$clean_content  = $this->clean_text( $extracted_text );
		
		// Fallback for scanned/empty text or parse failure: let user know or supply warning.
		if ( empty( $clean_content ) ) {
			$clean_content = esc_html__( '[Unable to extract text. The PDF might be scanned/image-only or encrypted.]', 'chat-pilot' );
		}

		$word_count = $this->count_words( $clean_content );
		$title      = isset( $config['original_name'] ) ? sanitize_file_name( $config['original_name'] ) : basename( $config['file_path'] );

		return array(
			array(
				'title'      => $title,
				'content'    => $clean_content,
				'source_url' => $config['file_path'],
				'metadata'   => array(
					'word_count' => $word_count,
					'file_size'  => filesize( $config['file_path'] ),
				),
			),
		);
	}

	/**
	 * Decompresses PDF FlateDecode streams and parses text blocks.
	 *
	 * @param string $data Raw PDF content.
	 * @return string Extracted text.
	 */
	private function extract_text_from_pdf( $data ) {
		$extracted_text = '';

		// Search for stream blocks.
		// Streams start with 'stream' and end with 'endstream'.
		$offset = 0;
		while ( ( $start = strpos( $data, 'stream', $offset ) ) !== false ) {
			$end = strpos( $data, 'endstream', $start );
			if ( false === $end ) {
				break;
			}

			// Extract stream header properties before the 'stream' keyword to check if it's FlateDecode.
			$header_start = max( 0, $start - 150 );
			$header_chunk = substr( $data, $header_start, $start - $header_start );
			
			// Move offset forward.
			$offset = $end + 9;

			// Skip if it's not a text-compatible stream.
			if ( strpos( $header_chunk, '/FlateDecode' ) === false ) {
				continue;
			}

			// Clean start index by moving past 'stream' keyword and any trailing carriage returns.
			$stream_start = $start + 6;
			if ( substr( $data, $stream_start, 2 ) === "\r\n" ) {
				$stream_start += 2;
			} elseif ( substr( $data, $stream_start, 1 ) === "\n" || substr( $data, $stream_start, 1 ) === "\r" ) {
				$stream_start += 1;
			}

			$stream_len = $end - $stream_start;
			if ( $stream_len <= 0 ) {
				continue;
			}

			$stream_data = substr( $data, $stream_start, $stream_len );
			
			// Decompress.
			$decompressed = @gzuncompress( $stream_data );
			if ( false === $decompressed ) {
				$decompressed = @gzinflate( $stream_data );
				if ( false === $decompressed ) {
					// Sometimes zlib header offsets need to be stripped.
					$decompressed = @gzinflate( substr( $stream_data, 2 ) );
				}
			}

			if ( ! empty( $decompressed ) ) {
				$extracted_text .= $this->parse_stream_text( $decompressed ) . "\n";
			}
		}

		return $extracted_text;
	}

	/**
	 * Parses text layout operators inside a decompressed page stream.
	 * Matches parentheses (Text) Tj, TJ, and text display operators.
	 *
	 * @param string $stream Decompressed PDF content stream.
	 * @return string Structured text output.
	 */
	private function parse_stream_text( $stream ) {
		$output = '';

		// Search for Begin Text (BT) and End Text (ET) operators.
		$bt_offset = 0;
		while ( ( $bt = strpos( $stream, 'BT', $bt_offset ) ) !== false ) {
			$et = strpos( $stream, 'ET', $bt );
			if ( false === $et ) {
				break;
			}

			$bt_offset = $et + 2;
			$text_chunk = substr( $stream, $bt + 2, $et - $bt - 2 );

			// Parse parentheses text segments inside this text chunk.
			// Matches text string operands like: (text) Tj, (text)' or [(t)-10(ext)] TJ
			$chunk_len = strlen( $text_chunk );
			$in_string = false;
			$string_buffer = '';
			$last_char_was_slash = false;

			for ( $i = 0; $i < $chunk_len; $i++ ) {
				$char = $text_chunk[$i];

				if ( $in_string ) {
					if ( $last_char_was_slash ) {
						// Handle escaped characters (like \), \), etc.)
						$string_buffer .= $char;
						$last_char_was_slash = false;
					} elseif ( '\\' === $char ) {
						$last_char_was_slash = true;
					} elseif ( ')' === $char ) {
						// End of string segment.
						$in_string = false;
						$output .= $string_buffer . ' ';
						$string_buffer = '';
					} else {
						$string_buffer .= $char;
					}
				} else {
					if ( '(' === $char ) {
						$in_string = true;
						$last_char_was_slash = false;
					}
				}
			}
			$output .= "\n";
		}

		return trim( $output );
	}
}
